import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type Stripe from 'stripe';

import { AuditLogService } from '../../common/audit/audit-log.service';
import { StripeService } from '../../common/stripe/stripe.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import { foundingCouponForPlan } from './founding-promo';
import {
  type TrialIdentity,
  isExemptEmail,
  parseExemptDomains,
  parseExemptEmails,
  trialIdentity,
} from './trial-identity';

/**
 * Subscriptions created before the guard shipped keep their trial. Ending one
 * charges a live card on the spot, and at launch 34 operators were already
 * trialing, many sharing a phone/card (staff test accounts, demo accounts) —
 * the first subscription.updated after deploy would have charged them. Their
 * identifiers are still recorded, so they count against any FUTURE account.
 */
export const TRIAL_GUARD_EFFECTIVE_FROM_UNIX = Math.floor(Date.parse('2026-11-04T20:30:00Z') / 1000);

/** Statuses where the account actually got service, so its identifiers count as "had a trial". */
const SERVED_STATUSES: ReadonlySet<Stripe.Subscription.Status> = new Set([
  'trialing',
  'active',
  'past_due',
  'unpaid',
  'canceled',
  'paused',
]);

/**
 * One free trial per person, not per account (cancel → new email → new trial).
 *
 * Every account that gets a subscription records hashed identifiers in
 * `trial_identities`: login email (alias-normalized), personal phone, card
 * fingerprint, Google Calendar email. Another account that matches any of them:
 *  - at checkout (email / phone known) → no trial and no Founding coupon;
 *  - after checkout (card) or at calendar connect (Google email) → the trial is
 *    ended now (Founding coupon removed first), so Stripe charges the card today.
 * Accounts on TRIAL_GUARD_EXEMPT_EMAIL_DOMAINS / TRIAL_GUARD_EXEMPT_EMAILS (any
 * alias of a listed mailbox) are neither checked nor recorded.
 */
@Injectable()
export class TrialGuardService {
  private readonly exemptDomains: ReadonlySet<string>;
  private readonly exemptEmails: ReadonlySet<string>;

  constructor(
    private readonly stripe: StripeService,
    private readonly supabase: SupabaseService,
    private readonly audit: AuditLogService,
    private readonly logger: PinoLogger,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {
    this.logger.setContext(TrialGuardService.name);
    this.exemptDomains = parseExemptDomains(env.TRIAL_GUARD_EXEMPT_EMAIL_DOMAINS);
    this.exemptEmails = parseExemptEmails(env.TRIAL_GUARD_EXEMPT_EMAILS);
  }

  /** Checkout: has this person (email / phone) already had a subscription on another account? */
  async hadTrialElsewhere(
    operator: { id: string; personal_phone_e164: string | null },
    email: string | null,
  ): Promise<boolean> {
    if (this.isExempt(email)) return false;
    const ids = compact([trialIdentity('email', email), trialIdentity('phone', operator.personal_phone_e164)]);
    const matched = await this.matchesElsewhere(operator.id, ids);
    if (matched.length > 0) {
      this.logger.warn({ operatorId: operator.id, matched }, 'trial guard: checkout without trial (identity used before)');
      await this.audit.write({
        actorUserId: null,
        operatorId: operator.id,
        action: 'trial.denied_at_checkout',
        resourceType: 'operator',
        resourceId: operator.id,
        metadata: { matched },
      });
    }
    return matched.length > 0;
  }

  /** Subscription created/updated webhook: record identifiers; end a duplicate trial. */
  async onSubscription(sub: Stripe.Subscription, operatorId: string): Promise<void> {
    if (!SERVED_STATUSES.has(sub.status)) return;
    const email = await this.loginEmail(operatorId);
    if (this.isExempt(email)) return;

    const ids = compact([
      ...(await this.knownIdentities(operatorId, email)),
      trialIdentity('card', await this.cardFingerprint(sub)),
    ]);
    // Check before recording so this account's own rows can't mask the result.
    // Grandfathered subscriptions (TRIAL_GUARD_EFFECTIVE_FROM_UNIX) are recorded, never ended.
    const enforce = sub.status === 'trialing' && sub.created >= TRIAL_GUARD_EFFECTIVE_FROM_UNIX;
    const matched = enforce ? await this.matchesElsewhere(operatorId, ids) : [];
    await this.record(operatorId, ids);
    if (matched.length > 0) await this.endTrial(operatorId, sub, matched);
  }

  /** Google Calendar connected: record the calendar email; end a duplicate trial. */
  async onCalendarConnected(operatorId: string, googleEmail: string | null): Promise<void> {
    const google = trialIdentity('google', googleEmail);
    if (!google) return;
    const email = await this.loginEmail(operatorId);
    if (this.isExempt(email)) return;

    const { data: op, error } = await this.supabase
      .db()
      .from('operators')
      .select('stripe_subscription_id, subscription_status')
      .eq('id', operatorId)
      .maybeSingle();
    if (error) throw error;
    if (!op?.stripe_subscription_id || !op.subscription_status) return; // no subscription yet: checkout records it

    const matched = op.subscription_status === 'trialing' ? await this.matchesElsewhere(operatorId, [google]) : [];
    await this.record(operatorId, [google]);
    if (matched.length > 0) {
      const sub = await this.stripe.client().subscriptions.retrieve(op.stripe_subscription_id);
      if (sub.status === 'trialing' && sub.created >= TRIAL_GUARD_EFFECTIVE_FROM_UNIX) {
        await this.endTrial(operatorId, sub, matched);
      }
    }
  }

  private async endTrial(operatorId: string, sub: Stripe.Subscription, matched: string[]): Promise<void> {
    const stripe = this.stripe.client();
    // The Founding coupon ($25 first month) is a new-customer offer too. An
    // admin-set special-pricing coupon is a staff decision and stays.
    const couponId = sub.discount?.coupon?.id ?? null;
    if (couponId && this.foundingCouponIds().has(couponId)) {
      await stripe.subscriptions.deleteDiscount(sub.id);
    }
    await stripe.subscriptions.update(sub.id, { trial_end: 'now', proration_behavior: 'none' });

    this.logger.warn(
      { operatorId, subscriptionId: sub.id, matched },
      'trial guard: trial ended — identity already used by another account',
    );
    await this.audit.write({
      actorUserId: null,
      operatorId,
      action: 'trial.ended_duplicate',
      resourceType: 'subscription',
      resourceId: sub.id,
      metadata: { matched, founding_coupon_removed: couponId != null && this.foundingCouponIds().has(couponId) },
    });
  }

  /** Kinds of `ids` already recorded by a different (or deleted) account. */
  private async matchesElsewhere(operatorId: string, ids: TrialIdentity[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.supabase
      .db()
      .from('trial_identities')
      .select('kind, operator_id')
      .in(
        'value_hash',
        ids.map((i) => i.hash),
      );
    if (error) throw error;
    const kinds = new Set((data ?? []).filter((r) => r.operator_id !== operatorId).map((r) => r.kind));
    return [...kinds].sort();
  }

  private async record(operatorId: string, ids: TrialIdentity[]): Promise<void> {
    if (ids.length === 0) return;
    const { error } = await this.supabase
      .db()
      .from('trial_identities')
      .upsert(
        ids.map((i) => ({ kind: i.kind, value_hash: i.hash, operator_id: operatorId })),
        { onConflict: 'kind,value_hash,operator_id', ignoreDuplicates: true },
      );
    if (error) throw error;
  }

  /** Email, phone and Google Calendar identifiers we already hold for the account. */
  private async knownIdentities(operatorId: string, email: string | null): Promise<Array<TrialIdentity | null>> {
    const db = this.supabase.db();
    const [{ data: op, error: opErr }, { data: cal, error: calErr }] = await Promise.all([
      db.from('operators').select('personal_phone_e164').eq('id', operatorId).maybeSingle(),
      db.from('calendar_connections').select('connected_email').eq('operator_id', operatorId).maybeSingle(),
    ]);
    if (opErr) throw opErr;
    if (calErr) throw calErr;
    return [
      trialIdentity('email', email),
      trialIdentity('phone', op?.personal_phone_e164),
      trialIdentity('google', cal?.connected_email),
    ];
  }

  /** Card fingerprint of the subscription's payment method (Checkout saves it on the subscription). */
  private async cardFingerprint(sub: Stripe.Subscription): Promise<string | null> {
    const pm = sub.default_payment_method;
    if (!pm) return null;
    const method = typeof pm === 'string' ? await this.stripe.client().paymentMethods.retrieve(pm) : pm;
    return method.card?.fingerprint ?? null;
  }

  private async loginEmail(operatorId: string): Promise<string | null> {
    const { data: op, error } = await this.supabase
      .db()
      .from('operators')
      .select('user_id')
      .eq('id', operatorId)
      .maybeSingle();
    if (error) throw error;
    if (!op?.user_id) return null;
    const { data, error: authErr } = await this.supabase.db().auth.admin.getUserById(op.user_id);
    if (authErr) throw authErr;
    return data.user?.email ?? null;
  }

  private isExempt(email: string | null): boolean {
    return isExemptEmail(email, this.exemptDomains, this.exemptEmails);
  }

  private foundingCouponIds(): ReadonlySet<string> {
    return new Set(
      compact((['solo', 'crew', 'fleet'] as const).map((p) => foundingCouponForPlan(this.env, p))),
    );
  }
}

function compact<T>(xs: ReadonlyArray<T | null | undefined>): T[] {
  return xs.filter((x): x is T => x != null);
}
