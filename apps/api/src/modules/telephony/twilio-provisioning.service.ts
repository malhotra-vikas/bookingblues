import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import {
  AppError,
  ConflictError,
  ExternalServiceError,
  NotFoundError,
} from '../../common/errors/app-error';
import { TwilioService } from '../../common/twilio/twilio.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import type { CandidateNumber, ProvisionNumberResponse } from './twilio-provisioning.dto';
import { vanitySlugs } from './vanity-slugs';

@Injectable()
export class TwilioProvisioningService {
  constructor(
    private readonly twilio: TwilioService,
    private readonly supabase: SupabaseService,
    private readonly logger: PinoLogger,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {
    this.logger.setContext(TwilioProvisioningService.name);
  }

  /**
   * Returns up to `limit` candidate local US numbers, biased toward vanity
   * matches derived from the operator's business name / trade category. The
   * UI shows these and the operator picks one to buy. Vanity hits are listed
   * first; we top up with plain area-code matches if vanity didn't fill the
   * list. Toll-free numbers are explicitly excluded — CLAUDE.md §17 (we use
   * local for the BB messaging service).
   */
  async findCandidates(args: {
    userId: string;
    areaCode?: string;
    limit?: number;
  }): Promise<ReadonlyArray<CandidateNumber>> {
    const limit = Math.max(1, Math.min(8, args.limit ?? 4));
    const { data: operator, error } = await this.supabase
      .db()
      .from('operators')
      .select('id, business_name, category')
      .eq('user_id', args.userId)
      .maybeSingle();
    if (error) throw error;
    if (!operator) throw new NotFoundError('Operator not found for this user');

    const slugs = vanitySlugs({
      businessName: operator.business_name,
      category: operator.category,
    });

    const out: CandidateNumber[] = [];
    const seen = new Set<string>();

    for (const slug of slugs) {
      if (out.length >= limit) break;
      const remaining = limit - out.length;
      try {
        const hits = await this.twilio.client().availablePhoneNumbers('US').local.list({
          ...(args.areaCode ? { areaCode: Number(args.areaCode) } : {}),
          contains: slug,
          smsEnabled: true,
          voiceEnabled: true,
          limit: remaining,
        });
        for (const h of hits) {
          if (seen.has(h.phoneNumber)) continue;
          seen.add(h.phoneNumber);
          out.push({
            phone_number_e164: h.phoneNumber,
            friendly_name: h.friendlyName ?? h.phoneNumber,
            vanity_match: slug,
            locality: h.locality ?? null,
            region: h.region ?? null,
          });
          if (out.length >= limit) break;
        }
      } catch (err) {
        // Twilio occasionally 400s on unsupported Contains values per region —
        // log and continue rather than fail the whole search.
        this.logger.warn(
          { slug, err: (err as Error).message },
          'vanity search failed for slug; continuing',
        );
      }
    }

    // Top up with plain (no-Contains) hits if vanity didn't fill the quota.
    if (out.length < limit) {
      const remaining = limit - out.length;
      const plain = await this.twilio.client().availablePhoneNumbers('US').local.list({
        ...(args.areaCode ? { areaCode: Number(args.areaCode) } : {}),
        smsEnabled: true,
        voiceEnabled: true,
        limit: remaining + out.length, // overshoot, dedupe below
      });
      for (const h of plain) {
        if (out.length >= limit) break;
        if (seen.has(h.phoneNumber)) continue;
        seen.add(h.phoneNumber);
        out.push({
          phone_number_e164: h.phoneNumber,
          friendly_name: h.friendlyName ?? h.phoneNumber,
          vanity_match: null,
          locality: h.locality ?? null,
          region: h.region ?? null,
        });
      }
    }

    if (out.length === 0) {
      throw new ExternalServiceError(
        'twilio',
        args.areaCode
          ? `No local numbers available in area code ${args.areaCode}`
          : 'No local US numbers available',
      );
    }
    return out;
  }

  /**
   * Provision a Twilio number for the operator. If `phoneNumberE164` is
   * supplied (typical: operator picked from `findCandidates`), buy that
   * specific number. Otherwise auto-pick the first cascading vanity hit
   * (falls back to plain area-code search if no vanity matches).
   */
  async provision(
    userId: string,
    args: { areaCode?: string; phoneNumberE164?: string } = {},
  ): Promise<ProvisionNumberResponse> {
    const { data: operator, error: lookupErr } = await this.supabase
      .db()
      .from('operators')
      .select('id, twilio_number_sid, twilio_number_e164')
      .eq('user_id', userId)
      .maybeSingle();
    if (lookupErr) throw lookupErr;
    if (!operator) throw new NotFoundError('Operator not found for this user');
    if (operator.twilio_number_sid || operator.twilio_number_e164) {
      throw new ConflictError('Operator already has a Twilio number');
    }

    const voiceUrl = `${this.env.API_URL}/webhooks/twilio/voice/${operator.id}`;
    const smsUrl = `${this.env.API_URL}/webhooks/twilio/sms/${operator.id}`;

    let candidate: string;
    if (args.phoneNumberE164) {
      // Operator picked a specific candidate. Trust it; Twilio will reject if
      // the number is no longer available or doesn't pass capability checks.
      candidate = args.phoneNumberE164;
    } else {
      // Auto-pick: first hit from the vanity-first cascading search.
      const candidates = await this.findCandidates({ userId, ...(args.areaCode ? { areaCode: args.areaCode } : {}), limit: 1 });
      candidate = candidates[0]!.phone_number_e164;
    }

    // Purchase + configure webhooks atomically (Twilio side).
    const purchased = await this.twilio.client().incomingPhoneNumbers.create({
      phoneNumber: candidate,
      voiceUrl,
      voiceMethod: 'POST',
      smsUrl,
      smsMethod: 'POST',
    });

    // Persist the pool row + link to operator. If the DB write fails after the
    // Twilio purchase, log loudly so ops can reconcile (number will be in
    // Twilio with no DB row).
    const { error: poolErr } = await this.supabase
      .db()
      .from('twilio_numbers')
      .insert({
        phone_number_e164: purchased.phoneNumber,
        twilio_sid: purchased.sid,
        operator_id: operator.id,
        status: 'assigned',
      });
    if (poolErr) {
      this.logger.error(
        { phoneNumber: purchased.phoneNumber, sid: purchased.sid, err: poolErr.message },
        'Twilio number purchased but pool insert failed — manual reconciliation required',
      );
      throw new AppError({
        code: 'telephony.pool_insert_failed',
        status: 500,
        detail: 'Number was provisioned in Twilio but DB insert failed. Ops will reconcile.',
        cause: poolErr,
      });
    }

    const { error: opUpdateErr } = await this.supabase
      .db()
      .from('operators')
      .update({
        twilio_number_e164: purchased.phoneNumber,
        twilio_number_sid: purchased.sid,
      })
      .eq('id', operator.id);
    if (opUpdateErr) {
      this.logger.error(
        { operatorId: operator.id, sid: purchased.sid },
        'Pool row inserted but operator link failed — manual reconciliation required',
      );
      throw opUpdateErr;
    }

    return { phone_number_e164: purchased.phoneNumber, twilio_sid: purchased.sid };
  }

  /**
   * Release the operator's Twilio number permanently. Twilio does NOT
   * guarantee the same number can be re-acquired — it goes back into the
   * provider pool and may be assigned to anyone within minutes. The web UI
   * presents an explicit "type the number to confirm" warning before this
   * endpoint is hit.
   */
  async release(userId: string): Promise<{ released_number: string }> {
    const { data: operator, error: lookupErr } = await this.supabase
      .db()
      .from('operators')
      .select('id, twilio_number_sid, twilio_number_e164')
      .eq('user_id', userId)
      .maybeSingle();
    if (lookupErr) throw lookupErr;
    if (!operator) throw new NotFoundError('Operator not found for this user');
    if (!operator.twilio_number_sid || !operator.twilio_number_e164) {
      throw new NotFoundError('Operator does not have a Twilio number to release');
    }

    // Tell Twilio to release the number (best-effort). Even if Twilio errors
    // (e.g. number already gone), we still mark it released DB-side so the
    // operator can re-provision; ops can reconcile any orphans on Twilio.
    try {
      await this.twilio.client().incomingPhoneNumbers(operator.twilio_number_sid).remove();
    } catch (err) {
      this.logger.error(
        { sid: operator.twilio_number_sid, err: (err as Error).message },
        'Twilio release call failed — proceeding with DB cleanup',
      );
    }

    // Mark the pool row released; clear the operator's pointer.
    const { error: poolErr } = await this.supabase
      .db()
      .from('twilio_numbers')
      .update({ status: 'released', released_at: new Date().toISOString(), operator_id: null })
      .eq('twilio_sid', operator.twilio_number_sid);
    if (poolErr) {
      this.logger.error(
        { sid: operator.twilio_number_sid, err: poolErr.message },
        'twilio_numbers update failed during release',
      );
      throw poolErr;
    }

    const { error: opErr } = await this.supabase
      .db()
      .from('operators')
      .update({ twilio_number_e164: null, twilio_number_sid: null })
      .eq('id', operator.id);
    if (opErr) throw opErr;

    return { released_number: operator.twilio_number_e164 };
  }
}
