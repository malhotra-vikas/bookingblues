import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { Tables } from '@bookingblues/db-types';

import { EncryptionService } from '../../common/crypto/encryption.service';
import { ExternalServiceError, NotFoundError, ValidationError } from '../../common/errors/app-error';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { asBusinessHours, slotWithinBusinessHours, type BusinessHours } from './business-hours';
import { GoogleOAuthService } from './google-oauth.service';

export type CalendarConnectionRow = Tables<'calendar_connections'>;

const ACCESS_TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;

@Injectable()
export class CalendarService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly encryption: EncryptionService,
    private readonly google: GoogleOAuthService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CalendarService.name);
  }

  async getConnection(operatorId: string): Promise<CalendarConnectionRow | null> {
    const { data, error } = await this.supabase
      .db()
      .from('calendar_connections')
      .select('*')
      .eq('operator_id', operatorId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async upsertConnection(args: {
    operatorId: string;
    refreshToken: string;
    accessToken: string;
    accessTokenExpiresAt: Date;
    scopes: ReadonlyArray<string>;
    connectedEmail: string | null;
  }): Promise<void> {
    const encrypted = this.encryption.encrypt(args.refreshToken);
    const row = {
      operator_id: args.operatorId,
      provider: 'google' as const,
      encrypted_refresh_token: encrypted,
      access_token_cache: args.accessToken,
      access_token_expires_at: args.accessTokenExpiresAt.toISOString(),
      scopes: args.scopes as string[],
      connected_email: args.connectedEmail,
      status: 'active' as const,
    };
    const { error } = await this.supabase
      .db()
      .from('calendar_connections')
      .upsert(row, { onConflict: 'operator_id' });
    if (error) throw error;

    // Stamp the operator with a connected_at timestamp + which calendar id.
    const { error: opErr } = await this.supabase
      .db()
      .from('operators')
      .update({
        google_calendar_id: 'primary',
        google_calendar_connected_at: new Date().toISOString(),
      })
      .eq('id', args.operatorId);
    if (opErr) throw opErr;
  }

  async markRevoked(operatorId: string, reason: string): Promise<void> {
    this.logger.warn({ operatorId, reason }, 'Marking calendar connection revoked');
    const { error } = await this.supabase
      .db()
      .from('calendar_connections')
      .update({ status: 'revoked' })
      .eq('operator_id', operatorId);
    if (error) throw error;
  }

  async disconnect(operatorId: string): Promise<void> {
    // Best-effort: mark revoked + clear the operator's calendar pointer. We
    // keep the row for audit (per CLAUDE.md "data minimization", we do not
    // retain the refresh token any longer though).
    const { error } = await this.supabase
      .db()
      .from('calendar_connections')
      .update({
        status: 'revoked',
        encrypted_refresh_token: 'v0:revoked:revoked:revoked',
        access_token_cache: null,
        access_token_expires_at: null,
      })
      .eq('operator_id', operatorId);
    if (error) throw error;

    const { error: opErr } = await this.supabase
      .db()
      .from('operators')
      .update({ google_calendar_id: null, google_calendar_connected_at: null })
      .eq('id', operatorId);
    if (opErr) throw opErr;
  }

  /**
   * Returns a fresh access token, refreshing via Google if the cached one is
   * within 60s of expiry. Catches refresh-failure (revoked grant) and marks
   * the connection accordingly per CLAUDE.md §9.4.
   */
  async getFreshAccessToken(operatorId: string): Promise<string> {
    const conn = await this.getConnection(operatorId);
    if (!conn) throw new NotFoundError('Calendar connection not found');
    if (conn.status === 'revoked') {
      throw new NotFoundError('Calendar connection is revoked — operator must reconnect');
    }

    const cachedExpiresAt = conn.access_token_expires_at
      ? new Date(conn.access_token_expires_at).getTime()
      : 0;
    if (
      conn.access_token_cache &&
      cachedExpiresAt - Date.now() > ACCESS_TOKEN_EXPIRY_BUFFER_MS
    ) {
      return conn.access_token_cache;
    }

    let refreshToken: string;
    try {
      refreshToken = this.encryption.decrypt(conn.encrypted_refresh_token);
    } catch (err) {
      this.logger.error({ operatorId, err: (err as Error).message }, 'Refresh token decrypt failed');
      throw new ExternalServiceError(
        'crypto',
        'Stored refresh token could not be decrypted — likely key rotation issue',
        err,
      );
    }

    let refreshed: { accessToken: string; expiresAt: Date };
    try {
      refreshed = await this.google.refreshAccessToken(refreshToken);
    } catch (err) {
      // Google returns 4xx with `invalid_grant` when the refresh token has been
      // revoked (user removed app from their Google account, password reset,
      // 6 months of inactivity, etc.). Treat as revoked.
      const msg = err instanceof Error ? err.message : String(err);
      if (/invalid[_ ]?grant/i.test(msg)) {
        await this.markRevoked(operatorId, 'invalid_grant on refresh');
      }
      throw new ExternalServiceError('google', `Failed to refresh access token: ${msg}`, err);
    }

    const { error } = await this.supabase
      .db()
      .from('calendar_connections')
      .update({
        access_token_cache: refreshed.accessToken,
        access_token_expires_at: refreshed.expiresAt.toISOString(),
      })
      .eq('operator_id', operatorId);
    if (error) throw error;

    return refreshed.accessToken;
  }

  /**
   * Slim wrapper around freebusy.query. Caller passes [windowStart, windowEnd]
   * in ISO 8601; returns the busy intervals from the operator's primary
   * calendar. Slot intersection with business_hours happens in Slice 7's
   * `check_availability` tool.
   */
  async freeBusy(args: {
    operatorId: string;
    windowStart: string;
    windowEnd: string;
    timeZone: string;
  }): Promise<ReadonlyArray<{ start: string; end: string }>> {
    const accessToken = await this.getFreshAccessToken(args.operatorId);
    const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        timeMin: args.windowStart,
        timeMax: args.windowEnd,
        timeZone: args.timeZone,
        items: [{ id: 'primary' }],
      }),
    });
    if (res.status === 401) {
      await this.markRevoked(args.operatorId, '401 from freeBusy');
      throw new ExternalServiceError('google', 'Calendar grant revoked (401 on freeBusy)');
    }
    if (!res.ok) {
      throw new ExternalServiceError(
        'google',
        `freeBusy failed: ${res.status} ${await res.text()}`,
      );
    }
    const json = (await res.json()) as {
      calendars?: Record<string, { busy?: ReadonlyArray<{ start: string; end: string }> }>;
    };
    return json.calendars?.['primary']?.busy ?? [];
  }

  /**
   * Insert a calendar event with `sendUpdates=all` so attendees get the email.
   * Per CLAUDE.md §9.4: pass `timeZone` on event insert to avoid DST bugs.
   */
  async insertEvent(args: {
    operatorId: string;
    summary: string;
    description?: string;
    startIso: string;
    endIso: string;
    timeZone: string;
    attendeeEmails: ReadonlyArray<string>;
  }): Promise<{ id: string; htmlLink: string | null }> {
    const accessToken = await this.getFreshAccessToken(args.operatorId);
    const body = {
      summary: args.summary,
      ...(args.description ? { description: args.description } : {}),
      start: { dateTime: args.startIso, timeZone: args.timeZone },
      end: { dateTime: args.endIso, timeZone: args.timeZone },
      attendees: args.attendeeEmails.map((email) => ({ email })),
    };
    const url =
      'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.status === 401) {
      await this.markRevoked(args.operatorId, '401 from events.insert');
      throw new ExternalServiceError('google', 'Calendar grant revoked (401 on events.insert)');
    }
    if (!res.ok) {
      throw new ExternalServiceError(
        'google',
        `events.insert failed: ${res.status} ${await res.text()}`,
      );
    }
    const json = (await res.json()) as { id?: string; htmlLink?: string };
    if (!json.id) {
      throw new ExternalServiceError('google', 'events.insert returned no id');
    }
    return { id: json.id, htmlLink: json.htmlLink ?? null };
  }

  /**
   * One-click test booking (for demos + "is my calendar working?" checks).
   * Exercises BOTH Google scopes end-to-end: reads free/busy (calendar.freebusy)
   * to find a genuinely open slot within business hours, then creates the event
   * (calendar.events). Does NOT touch the `appointments` table — it's a real
   * calendar event only, clearly labeled and safe to delete.
   */
  async createTestBooking(args: {
    operatorId: string;
    timeZone: string;
    businessHours: unknown;
    durationMin: number;
  }): Promise<{ startIso: string; endIso: string; eventId: string; htmlLink: string | null }> {
    const bh: BusinessHours | null = asBusinessHours(args.businessHours);
    const now = Date.now();
    const windowStart = new Date(now).toISOString();
    const windowEnd = new Date(now + 7 * 86_400_000).toISOString();

    const busy = await this.freeBusy({
      operatorId: args.operatorId,
      windowStart,
      windowEnd,
      timeZone: args.timeZone,
    });

    // Scan forward in 30-min steps from ~2h out; pick the first slot that's both
    // inside business hours and not overlapping a busy interval.
    const durMs = args.durationMin * 60_000;
    for (let offsetMin = 120; offsetMin <= 7 * 24 * 60; offsetMin += 30) {
      const start = new Date(now + offsetMin * 60_000);
      start.setUTCSeconds(0, 0);
      start.setUTCMinutes(start.getUTCMinutes() < 30 ? 0 : 30); // align to :00/:30
      const startIso = start.toISOString();
      const endIso = new Date(start.getTime() + durMs).toISOString();
      if (!slotWithinBusinessHours(startIso, endIso, bh, args.timeZone).ok) continue;
      const overlaps = busy.some((b) => startIso < b.end && endIso > b.start);
      if (overlaps) continue;

      const event = await this.insertEvent({
        operatorId: args.operatorId,
        summary: '✅ KeeprSteady test appointment',
        description:
          'This is a test booking created by KeeprSteady to confirm your Google Calendar ' +
          'connection is working. It behaves exactly like a real booking. Safe to delete.',
        startIso,
        endIso,
        timeZone: args.timeZone,
        attendeeEmails: [],
      });
      return { startIso, endIso, eventId: event.id, htmlLink: event.htmlLink };
    }

    throw new ValidationError(
      'No open slot found in the next 7 days within your business hours — add some open hours in Settings and try again.',
    );
  }

  /**
   * Patch an existing event — used to add the full property address (collected
   * after payment) to the invite's `location`, so the tech can navigate there.
   * `sendUpdates=all` notifies the caller-attendee of the update.
   */
  async patchEvent(args: {
    operatorId: string;
    eventId: string;
    location?: string;
    description?: string;
  }): Promise<void> {
    const accessToken = await this.getFreshAccessToken(args.operatorId);
    const body: { location?: string; description?: string } = {};
    if (args.location !== undefined) body.location = args.location;
    if (args.description !== undefined) body.description = args.description;

    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(
      args.eventId,
    )}?sendUpdates=all`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.status === 401) {
      await this.markRevoked(args.operatorId, '401 from events.patch');
      throw new ExternalServiceError('google', 'Calendar grant revoked (401 on events.patch)');
    }
    if (!res.ok) {
      throw new ExternalServiceError(
        'google',
        `events.patch failed: ${res.status} ${await res.text()}`,
      );
    }
  }
}
