import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../common/errors/app-error';
import { StripeService } from '../../common/stripe/stripe.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';

@Injectable()
export class ConnectOnboardingService {
  constructor(
    private readonly stripe: StripeService,
    private readonly supabase: SupabaseService,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {}

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
      const { error: updErr } = await this.supabase
        .db()
        .from('operators')
        .update({ stripe_connect_account_id: accountId })
        .eq('id', operator.id);
      if (updErr) throw updErr;
    }

    const link = await this.stripe.client().accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      refresh_url: `${this.env.APP_URL}/onboarding/connect?refresh=1`,
      return_url: `${this.env.APP_URL}/onboarding/connect?return=1`,
    });
    return { url: link.url };
  }
}
