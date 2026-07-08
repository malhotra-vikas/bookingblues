import {
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';

import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthenticatedUser } from '../../common/auth/jwt-verifier.service';
import { ValidationError } from '../../common/errors/app-error';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import { CalendarService } from './calendar.service';
import { signState, verifyState } from './calendar-state';
import { GoogleOAuthService } from './google-oauth.service';

@Controller()
export class CalendarController {
  constructor(
    private readonly calendar: CalendarService,
    private readonly google: GoogleOAuthService,
    private readonly supabase: SupabaseService,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {}

  @Post('operators/me/google/connect')
  @UseGuards(AuthGuard)
  connect(@CurrentUser() user: AuthenticatedUser): { url: string } {
    if (!this.env.SUPABASE_JWT_SECRET) {
      throw new ValidationError('Server not configured for OAuth state signing');
    }
    const state = signState({ userId: user.userId, secret: this.env.SUPABASE_JWT_SECRET });
    return { url: this.google.authUrl(state) };
  }

  /**
   * One-click test booking — creates a real event on the connected calendar in
   * the next open slot. Demonstrates the full booking (freebusy read + event
   * write) without a long SMS conversation; also a handy "is my calendar
   * working?" check. Does not create an `appointments` row.
   */
  @Post('operators/me/calendar/test-event')
  @UseGuards(AuthGuard)
  async testEvent(@CurrentUser() user: AuthenticatedUser): Promise<{
    start: string;
    end: string;
    event_id: string;
    html_link: string | null;
  }> {
    const { data: operator, error } = await this.supabase
      .db()
      .from('operators')
      .select('id, timezone, business_hours, visit_duration_min')
      .eq('user_id', user.userId)
      .maybeSingle();
    if (error) throw error;
    if (!operator) throw new ValidationError('Operator not found');

    const result = await this.calendar.createTestBooking({
      operatorId: operator.id,
      timeZone: operator.timezone,
      businessHours: operator.business_hours,
      durationMin: operator.visit_duration_min ?? 60,
    });
    return {
      start: result.startIso,
      end: result.endIso,
      event_id: result.eventId,
      html_link: result.htmlLink,
    };
  }

  @Post('operators/me/google/disconnect')
  @UseGuards(AuthGuard)
  async disconnect(@CurrentUser() user: AuthenticatedUser): Promise<{ ok: true }> {
    const { data: operator, error } = await this.supabase
      .db()
      .from('operators')
      .select('id')
      .eq('user_id', user.userId)
      .maybeSingle();
    if (error) throw error;
    if (!operator) throw new ValidationError('Operator not found');
    await this.calendar.disconnect(operator.id);
    return { ok: true };
  }

  @Get('webhooks/google/oauth/callback')
  @SkipThrottle()
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (error) {
      return this.redirect(res, { error });
    }
    if (!code || !state) {
      return this.redirect(res, { error: 'missing_code_or_state' });
    }
    if (!this.env.SUPABASE_JWT_SECRET) {
      return this.redirect(res, { error: 'server_misconfigured' });
    }

    let userId: string;
    try {
      userId = verifyState({ state, secret: this.env.SUPABASE_JWT_SECRET }).userId;
    } catch {
      return this.redirect(res, { error: 'invalid_state' });
    }

    const { data: operator, error: opErr } = await this.supabase
      .db()
      .from('operators')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();
    if (opErr || !operator) {
      return this.redirect(res, { error: 'operator_not_found' });
    }

    try {
      const tokens = await this.google.exchangeCode(code);
      await this.calendar.upsertConnection({
        operatorId: operator.id,
        refreshToken: tokens.refreshToken,
        accessToken: tokens.accessToken,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        scopes: tokens.grantedScopes,
        connectedEmail: tokens.email,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.redirect(res, { error: `exchange_failed:${msg}` });
    }

    return this.redirect(res, { connected: 'google' });
  }

  private redirect(res: Response, params: Record<string, string>): void {
    const qs = new URLSearchParams(params).toString();
    res.redirect(`${this.env.APP_URL}/onboarding?${qs}`);
  }
}
