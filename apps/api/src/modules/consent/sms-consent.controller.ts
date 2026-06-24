import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import parsePhoneNumber from 'libphonenumber-js';
import { PinoLogger } from 'nestjs-pino';

import { AppError } from '../../common/errors/app-error';
import { ZodBodyPipe } from '../../common/pipes/zod-body.pipe';
import { SupabaseService } from '../../common/supabase/supabase.service';

import { CONSENT_TEXT, CONSENT_VERSION, SmsOptInSchema, type SmsOptInDto } from './sms-consent.dto';

function maskPhone(e164: string): string {
  return `•••${e164.slice(-4)}`;
}

/**
 * Public SMS opt-in capture. Backs the /messaging/opt-in web form, which is the
 * consent-collection URL cited in our A2P 10DLC campaign. A consumer who wants
 * the AI scheduling assistant to text them submits their name + number and
 * checks the (optional, unchecked-by-default) consent box; we persist a durable
 * consent record (the exact disclosure wording, version, timestamp, IP, and
 * user-agent) as proof. Consent is never a condition of submitting the form —
 * a submission without it succeeds and simply records nothing.
 *
 * No auth (consumers aren't BookingBlues users), but per-IP throttled to keep
 * the endpoint from being scripted into a spam vector. We never auto-send SMS
 * from here — this records consent only.
 */
@Controller('sms-opt-in')
export class SmsConsentController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SmsConsentController.name);
  }

  @Post()
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async optIn(
    @Body(new ZodBodyPipe(SmsOptInSchema)) body: SmsOptInDto,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    const parsed = parsePhoneNumber(body.phone, 'US');
    if (!parsed?.isValid()) {
      throw new AppError({
        code: 'sms_opt_in.invalid_phone',
        status: 400,
        detail: 'Enter a valid US mobile number so we can text you.',
      });
    }
    const phoneE164 = parsed.number;

    // SMS consent is optional (carrier/CTIA rule — it must not gate the form).
    // When the user didn't opt in, there's nothing to record and we must never
    // text them, so accept the submission and stop here.
    if (!body.consent) {
      this.logger.info({ phone: maskPhone(phoneE164) }, 'sms-opt-in: submitted without consent');
      return { ok: true };
    }

    const ipAddress =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
      req.ip ||
      null;
    const userAgent = (req.headers['user-agent'] as string | undefined) ?? null;

    const { error } = await this.supabase
      .db()
      .from('sms_consents')
      .insert({
        name: body.name,
        phone_e164: phoneE164,
        trade: body.trade ?? null,
        source: 'web_opt_in',
        consent_version: CONSENT_VERSION,
        consent_text: CONSENT_TEXT,
        ip_address: ipAddress,
        user_agent: userAgent,
      });

    if (error) {
      // Fail loudly — a dropped consent record is a compliance gap, not a
      // best-effort notification (CLAUDE.md §2: no silent fallbacks).
      this.logger.error({ err: error.message }, 'sms-opt-in: consent insert failed');
      throw new AppError({
        code: 'sms_opt_in.persist_failed',
        status: 502,
        detail: 'Could not record your opt-in. Please try again.',
      });
    }

    this.logger.info({ phone: maskPhone(phoneE164) }, 'sms-opt-in: consent recorded');
    return { ok: true };
  }
}
