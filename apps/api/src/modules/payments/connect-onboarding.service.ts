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
    this.logger.info({ userId, hasEmail: Boolean(userEmail) }, 'connect.onboarding: start');

    const { data: operator, error } = await this.supabase
      .db()
      .from('operators')
      .select('id, stripe_connect_account_id, business_name')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      this.logger.error({ userId, err: error.message }, 'connect.onboarding: operator lookup failed');
      throw error;
    }
    if (!operator) {
      this.logger.warn({ userId }, 'connect.onboarding: no operator for user');
      throw new NotFoundError('Operator not found');
    }

    let accountId = operator.stripe_connect_account_id;
    this.logger.info(
      { operatorId: operator.id, existingAccountId: accountId ?? null },
      accountId
        ? 'connect.onboarding: reusing existing connect account'
        : 'connect.onboarding: no connect account yet, creating one',
    );
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
        this.logger.info(
          { operatorId: operator.id, accountId },
          'connect.onboarding: stripe.accounts.create succeeded',
        );
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
      if (updErr) {
        this.logger.error(
          { operatorId: operator.id, accountId, err: updErr.message },
          'connect.onboarding: failed to persist stripe_connect_account_id',
        );
        throw updErr;
      }
    }

    this.logger.info(
      { operatorId: operator.id, accountId },
      'connect.onboarding: creating account onboarding link',
    );
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
      this.logger.info(
        { operatorId: operator.id, accountId },
        'connect.onboarding: account link created, returning url',
      );
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

  /**
   * Pull the connected account's live capability state from Stripe and
   * persist it onto the operator row. This is the defensive complement to the
   * `account.updated` Connect webhook: the webhook is the push path, this is the
   * pull path the operator triggers when they return from Stripe onboarding, so
   * the UI isn't permanently stuck on "verifying" if a webhook is missed or no
   * Connect endpoint is wired yet. Fails loudly — no silent fallback (§2).
   */
  async syncAccountStatus(
    userId: string,
  ): Promise<{ charges_enabled: boolean; payouts_enabled: boolean; details_submitted: boolean }> {
    this.logger.info({ userId }, 'connect.sync: start');

    const { data: operator, error } = await this.supabase
      .db()
      .from('operators')
      .select('id, stripe_connect_account_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      this.logger.error({ userId, err: error.message }, 'connect.sync: operator lookup failed');
      throw error;
    }
    if (!operator) {
      this.logger.warn({ userId }, 'connect.sync: no operator for user');
      throw new NotFoundError('Operator not found');
    }

    const accountId = operator.stripe_connect_account_id;
    if (!accountId) {
      // Nothing to sync — operator never started Connect onboarding.
      this.logger.info({ operatorId: operator.id }, 'connect.sync: no connect account, nothing to sync');
      return { charges_enabled: false, payouts_enabled: false, details_submitted: false };
    }

    let account: Awaited<ReturnType<ReturnType<StripeService['client']>['accounts']['retrieve']>>;
    try {
      account = await this.stripe.client().accounts.retrieve(accountId);
    } catch (err) {
      const e = err as { message?: string; raw?: { message?: string; code?: string }; type?: string };
      const msg = e.raw?.message ?? e.message ?? 'unknown error';
      this.logger.error(
        { operatorId: operator.id, accountId, stripeCode: e.raw?.code, stripeType: e.type, err: msg },
        'connect.sync: stripe.accounts.retrieve failed',
      );
      throw new AppError({
        code: 'payments.connect_sync_failed',
        status: 502,
        detail: `Stripe couldn't return your payout account status: ${msg}`,
      });
    }

    const chargesEnabled = account.charges_enabled ?? false;
    const payoutsEnabled = account.payouts_enabled ?? false;
    const detailsSubmitted = account.details_submitted ?? false;

    const { error: updErr } = await this.supabase
      .db()
      .from('operators')
      .update({
        stripe_connect_charges_enabled: chargesEnabled,
        stripe_connect_payouts_enabled: payoutsEnabled,
      })
      .eq('id', operator.id);
    if (updErr) {
      this.logger.error(
        { operatorId: operator.id, accountId, err: updErr.message },
        'connect.sync: failed to persist connect flags',
      );
      throw updErr;
    }

    this.logger.info(
      { operatorId: operator.id, accountId, chargesEnabled, payoutsEnabled, detailsSubmitted },
      'connect.sync: flags synced from stripe',
    );
    return {
      charges_enabled: chargesEnabled,
      payouts_enabled: payoutsEnabled,
      details_submitted: detailsSubmitted,
    };
  }
}
