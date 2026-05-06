import { Injectable } from '@nestjs/common';
import type { Tables, TablesUpdate } from '@bookingblues/db-types';

import { SupabaseService } from '../../common/supabase/supabase.service';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors/app-error';
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
  constructor(private readonly supabase: SupabaseService) {}

  async getByUserId(userId: string): Promise<OperatorRow | null> {
    const { data, error } = await this.supabase
      .db()
      .from('operators')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async getByUserIdRequired(userId: string): Promise<OperatorRow> {
    const op = await this.getByUserId(userId);
    if (!op) throw new NotFoundError('Operator not found for this user');
    return op;
  }

  async update(userId: string, patch: UpdateOperator): Promise<OperatorRow> {
    const existing = await this.getByUserIdRequired(userId);

    const update: TablesUpdate<'operators'> = {};
    if (patch.business_name !== undefined) update.business_name = patch.business_name;
    if (patch.category !== undefined) update.category = patch.category;
    if (patch.timezone !== undefined) update.timezone = patch.timezone;
    if (patch.business_hours !== undefined) update.business_hours = patch.business_hours;
    if (patch.booking_fee_enabled !== undefined) {
      update.booking_fee_enabled = patch.booking_fee_enabled;
    }
    if (patch.booking_fee_cents !== undefined) update.booking_fee_cents = patch.booking_fee_cents;

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
}
