import { Inject, Injectable } from '@nestjs/common';
import type { Tables, TablesUpdate } from '@bookingblues/db-types';
import parsePhoneNumber from 'libphonenumber-js';
import { PinoLogger } from 'nestjs-pino';

import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors/app-error';
import { depositModeForPlan } from '../billing/plan-policy';
import type { UpdateOperator } from './operators.dto';

export type OperatorRow = Tables<'operators'>;

export interface OnboardingStatus {
  readonly steps: {
    readonly category: boolean;
    readonly personal_phone: boolean;
    readonly twilio_number: boolean;
    readonly calendar: boolean;
    readonly booking_fee_decided: boolean;
  };
  readonly completed: boolean;
}

@Injectable()
export class OperatorsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly logger: PinoLogger,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {
    this.logger.setContext(OperatorsService.name);
  }

  async getByUserId(userId: string): Promise<OperatorRow | null> {
    const { data, error } = await this.supabase
      .db()
      .from('operators')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;

    // Lazy bootstrap: fresh signups don't have an operator row yet.
    // Signup stashes business_name + personal_phone_e164 in user_metadata
    // (Supabase Auth). Read it and insert the row idempotently. Returns null
    // if signup metadata is missing — the controller surfaces a clear error.
    return this.tryBootstrapFromAuthMetadata(userId);
  }

  private async tryBootstrapFromAuthMetadata(userId: string): Promise<OperatorRow | null> {
    let metadata: Record<string, unknown> = {};
    try {
      const { data, error } = await this.supabase.db().auth.admin.getUserById(userId);
      if (error || !data?.user) return null;
      metadata = (data.user.user_metadata ?? {}) as Record<string, unknown>;
    } catch (err) {
      this.logger.warn({ userId, err: (err as Error).message }, 'auth.getUserById failed during bootstrap');
      return null;
    }

    const businessName = typeof metadata.business_name === 'string' ? metadata.business_name.trim() : '';
    if (!businessName) return null;

    const phoneRaw = typeof metadata.personal_phone_e164 === 'string' ? metadata.personal_phone_e164 : '';
    const parsed = phoneRaw ? parsePhoneNumber(phoneRaw, 'US') : null;
    const phoneE164 = parsed?.isValid() ? parsed.number : null;

    const insert = {
      user_id: userId,
      business_name: businessName,
      ...(phoneE164 ? { personal_phone_e164: phoneE164 } : {}),
      ...termsFromMetadata(metadata),
    };
    const { data: created, error: insertErr } = await this.supabase
      .db()
      .from('operators')
      .insert(insert)
      .select('*')
      .single();
    if (insertErr) {
      // Race — another concurrent request already inserted. Re-read and return.
      if (insertErr.code === '23505') {
        const { data: existing } = await this.supabase
          .db()
          .from('operators')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle();
        return existing ?? null;
      }
      this.logger.error({ userId, err: insertErr.message }, 'bootstrap insert failed');
      throw insertErr;
    }
    this.logger.info({ userId, operatorId: created.id }, 'bootstrapped operator from signup metadata');
    return created;
  }

  async getByUserIdRequired(userId: string): Promise<OperatorRow> {
    const op = await this.getByUserId(userId);
    if (!op) throw new NotFoundError('Operator not found for this user');
    return op;
  }

  async update(userId: string, patch: UpdateOperator): Promise<OperatorRow> {
    const existing = await this.getByUserIdRequired(userId);

    // Plumbing-only MVP gate (PROGRESS.md Slice 16). Reject categories the
    // current deployment has feature-flagged off, even if the DB still seeds
    // them. The FK check below catches *unknown* slugs; this catches
    // *disabled* ones with a clearer error.
    if (patch.category !== undefined && !this.env.ENABLED_CATEGORY_SET.has(patch.category)) {
      throw new ValidationError(
        `Category "${patch.category}" is not currently enabled. Available: ${[...this.env.ENABLED_CATEGORY_SET].join(', ')}.`,
        { path: ['category'] },
      );
    }

    const update: TablesUpdate<'operators'> = {};
    if (patch.business_name !== undefined) update.business_name = patch.business_name;
    if (patch.category !== undefined) update.category = patch.category;
    if (patch.timezone !== undefined) update.timezone = patch.timezone;
    if (patch.business_hours !== undefined) update.business_hours = patch.business_hours;
    if (patch.booking_fee_enabled !== undefined) {
      update.booking_fee_enabled = patch.booking_fee_enabled;
    }
    if (patch.booking_fee_cents !== undefined) update.booking_fee_cents = patch.booking_fee_cents;
    if (patch.service_zip_codes !== undefined) {
      // De-dupe + sort for stable storage and easier diffing.
      update.service_zip_codes = [...new Set(patch.service_zip_codes)].sort();
    }
    if (patch.service_radius_zones !== undefined) {
      update.service_radius_zones = patch.service_radius_zones;
    }

    // Reject the case where the patch turns on the fee without supplying cents
    // (in addition to the DTO refine — defensive against partial patches across
    // multiple requests).
    const willEnable = update.booking_fee_enabled ?? existing.booking_fee_enabled;
    const willCents =
      update.booking_fee_cents !== undefined ? update.booking_fee_cents : existing.booking_fee_cents;
    if (willEnable === true && willCents == null) {
      throw new ValidationError(
        'booking_fee_cents must be set before enabling fee collection',
        { path: ['booking_fee_cents'] },
      );
    }

    // Fleet mandates deposit collection (#booking-fee) — block turning it off,
    // matching the UI which locks the toggle on. Mirrors depositModeForPlan.
    if (depositModeForPlan(existing.plan) === 'mandatory' && willEnable === false) {
      throw new ValidationError(
        'Your plan requires deposit collection and it cannot be disabled.',
        { path: ['booking_fee_enabled'] },
      );
    }

    if (Object.keys(update).length === 0) return existing;

    const { data, error } = await this.supabase
      .db()
      .from('operators')
      .update(update)
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) {
      // Foreign-key violation on category slug — surface as 400.
      if (error.code === '23503') {
        throw new ValidationError(`Unknown category: ${patch.category ?? '<unknown>'}`);
      }
      // Operator already has a unique value in flight (rare for these fields, but defensive).
      if (error.code === '23505') {
        throw new ConflictError('Update conflicts with an existing record');
      }
      throw error;
    }
    return data;
  }

  getOnboardingStatus(op: OperatorRow): OnboardingStatus {
    const steps = {
      category: op.category != null,
      personal_phone: op.personal_phone_e164 != null,
      twilio_number: op.twilio_number_e164 != null,
      calendar: op.google_calendar_id != null,
      booking_fee_decided: op.booking_fee_enabled === false || op.booking_fee_cents != null,
    };
    const completed =
      op.onboarding_completed_at != null ||
      Object.values(steps).every((s) => s === true);
    return { steps, completed };
  }

  /**
   * Record a Terms of Service / Privacy re-acceptance, server-side. The
   * timestamp is the server clock (never trust a client-supplied one);
   * `version` is the version string the client displayed and the user
   * accepted. Bootstraps the operator row first if it doesn't exist yet.
   */
  async recordTermsAcceptance(userId: string, version: string): Promise<OperatorRow> {
    const operator = await this.getByUserIdRequired(userId);
    const { data, error } = await this.supabase
      .db()
      .from('operators')
      .update({ terms_accepted_at: new Date().toISOString(), terms_version: version })
      .eq('id', operator.id)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }
}

/**
 * Pull the consent fields stashed in auth.users.user_metadata at signup into
 * an operators insert fragment. Returns an empty object when absent so the
 * spread is a no-op for pre-feature signups.
 */
export function termsFromMetadata(
  metadata: Record<string, unknown>,
): { terms_accepted_at?: string; terms_version?: string } {
  const out: { terms_accepted_at?: string; terms_version?: string } = {};
  if (typeof metadata.terms_accepted_at === 'string') out.terms_accepted_at = metadata.terms_accepted_at;
  if (typeof metadata.terms_version === 'string') out.terms_version = metadata.terms_version;
  return out;
}
