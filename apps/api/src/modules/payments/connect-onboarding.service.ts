import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { AppError, NotFoundError } from '../../common/errors/app-error';
import { StripeService } from '../../common/stripe/stripe.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';

@Injectable()
export class ConnectOnboardingService {
  constructor(
    private readonly stripe: StripeService,
    private readonly supabase: SupabaseService,
    private readonly logger: PinoLogger,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {
    this.logger.setContext(ConnectOnboardingService.name);
  }

  async createOnboardingLink(userId: string, userEmail: string | null): Promise<{ url: string }> {
    const { data: operator, error } = await this.supabase
      .db()
      .from('operators')
      .select('id, stripe_connect_account_id, business_name')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!operator) throw new NotFoundError('Operator not found');

    let accountId = operator.stripe_connect_account_id;
    if (!accountId) {
      try {
        const account = await this.stripe.client().accounts.create({
          type: 'express',
          country: 'US',
          ...(userEmail ? { email: userEmail } : {}),
          business_type: 'individual',
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          metadata: { operator_id: operator.id, user_id: userId },
        });
        accountId = account.id;
      } catch (err) {
        const e = err as { message?: string; raw?: { message?: string; code?: string }; type?: string };
        const msg = e.raw?.message ?? e.message ?? 'unknown error';
        this.logger.error(
          { operatorId: operator.id, stripeCode: e.raw?.code, stripeType: e.type, err: msg },
          'stripe.accounts.create failed',
        );
        throw new AppError({
          code: 'payments.connect_create_failed',
          status: 502,
          // Pass the Stripe message through so the operator sees something
          // actionable (e.g. "Your platform has not enabled Connect in test mode").
          detail: `Stripe couldn't create your payout account: ${msg}`,
        });
      }
      const { error: updErr } = await this.supabase
        .db()
        .from('operators')
        .update({ stripe_connect_account_id: accountId })
        .eq('id', operator.id);
      if (updErr) throw updErr;
    }

    try {
      const link = await this.stripe.client().accountLinks.create({
        account: accountId,
        type: 'account_onboarding',
        // `/onboarding/connect` didn't exist — Stripe was sending operators to
        // a 404 when they finished. Land them back on the wizard with a
        // visible status banner driven by the ?connect=... query.
        refresh_url: `${this.env.APP_URL}/onboarding?connect=refresh`,
        return_url: `${this.env.APP_URL}/onboarding?connect=return`,
      });
      return { url: link.url };
    } catch (err) {
      const e = err as { message?: string; raw?: { message?: string; code?: string }; type?: string };
      const msg = e.raw?.message ?? e.message ?? 'unknown error';
      this.logger.error(
        { operatorId: operator.id, accountId, stripeCode: e.raw?.code, stripeType: e.type, err: msg },
        'stripe.accountLinks.create failed',
      );
      throw new AppError({
        code: 'payments.connect_link_failed',
        status: 502,
        detail: `Stripe couldn't generate your onboarding link: ${msg}`,
      });
    }
  }
}
