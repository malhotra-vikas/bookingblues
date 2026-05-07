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
import type { ProvisionNumberResponse } from './twilio-provisioning.dto';

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

  async provision(userId: string, areaCode?: string): Promise<ProvisionNumberResponse> {
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

    // Search for an available local US number in the requested area code (or any).
    const search = await this.twilio.client().availablePhoneNumbers('US').local.list({
      ...(areaCode ? { areaCode: Number(areaCode) } : {}),
      smsEnabled: true,
      voiceEnabled: true,
      limit: 1,
    });
    if (search.length === 0) {
      throw new ExternalServiceError(
        'twilio',
        areaCode
          ? `No local numbers available in area code ${areaCode}`
          : 'No local US numbers available',
      );
    }
    const candidate = search[0]!.phoneNumber;

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
