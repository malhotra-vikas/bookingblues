import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { PinoLogger } from 'nestjs-pino';

import { StripeService } from '../../common/stripe/stripe.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import { expandUuid } from '../../common/util/uuid';

/**
 * Public short-link that 302-redirects an SMS recipient to their Stripe
 * Checkout. We send `${API_URL}/pay/:appointmentId` (clean, no special chars,
 * fully tappable) instead of the raw Stripe URL, whose `#`/`%` fragment breaks
 * SMS link detection on many phones. The live Checkout URL is resolved on
 * click from the appointment's stored `fee_checkout_session_id`.
 */
@Controller('pay')
@SkipThrottle()
export class PaymentRedirectController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly stripe: StripeService,
    private readonly logger: PinoLogger,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {
    this.logger.setContext(PaymentRedirectController.name);
  }

  @Get(':token')
  async redirect(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const appointmentId = expandUuid(token);
    const result = (status: string): void =>
      res.redirect(302, `${this.env.APP_URL}/booking/result?status=${status}`);

    const { data: appt, error } = await this.supabase
      .db()
      .from('appointments')
      .select('id, operator_id, fee_status, fee_checkout_session_id')
      .eq('id', appointmentId)
      .maybeSingle();
    if (error || !appt) {
      this.logger.warn({ appointmentId, err: error?.message }, 'pay redirect: appointment not found');
      return result('unavailable');
    }
    if (appt.fee_status === 'paid') {
      return result('paid');
    }
    if (!appt.fee_checkout_session_id) {
      return result('unavailable');
    }

    const { data: operator } = await this.supabase
      .db()
      .from('operators')
      .select('stripe_connect_account_id')
      .eq('id', appt.operator_id)
      .maybeSingle();
    if (!operator?.stripe_connect_account_id) {
      return result('unavailable');
    }

    try {
      const session = await this.stripe
        .client()
        .checkout.sessions.retrieve(appt.fee_checkout_session_id, {
          stripeAccount: operator.stripe_connect_account_id,
        });
      if (session.status === 'open' && session.url) {
        return res.redirect(302, session.url);
      }
      // complete (already paid) or expired → friendly page rather than a dead link.
      return result(session.status === 'complete' ? 'paid' : 'expired');
    } catch (err) {
      this.logger.error(
        { appointmentId, err: (err as Error).message },
        'pay redirect: stripe session retrieve failed',
      );
      return result('unavailable');
    }
  }
}
