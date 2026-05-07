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
}
