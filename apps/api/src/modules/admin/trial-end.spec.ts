import type { PinoLogger } from 'nestjs-pino';

import { ValidationError } from '../../common/errors/app-error';
import { AdminWriteService } from './admin-write.service';

const NOW = new Date('2026-11-09T20:00:00Z');
const ACTOR = { actorUserId: 'admin_1', ipAddress: null, userAgent: null };

function makeLogger(): PinoLogger {
  return { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
}

function setup(operator: Record<string, unknown>, stripeUpdate?: jest.Mock) {
  const updates: unknown[] = [];
  const q: Record<string, unknown> = {};
  q.from = () => q;
  q.select = () => q;
  q.eq = () => q;
  q.maybeSingle = () => Promise.resolve({ data: operator, error: null });
  q.update = (patch: unknown) => {
    updates.push(patch);
    return { eq: () => Promise.resolve({ error: null }) };
  };
  const supabase = { db: () => q };
  const subUpdate = stripeUpdate ?? jest.fn();
  const stripe = { client: () => ({ subscriptions: { update: subUpdate } }) };
  const audit = { write: jest.fn().mockResolvedValue(undefined) };
  const service = new AdminWriteService(
    supabase as never,
    stripe as never,
    {} as never,
    {} as never,
    audit as never,
    {} as never,
    makeLogger(),
    {} as never,
  );
  return { service, updates, subUpdate, audit };
}

const TRIALING_STRIPE = {
  id: 'op_1',
  subscription_status: 'trialing',
  stripe_subscription_id: 'sub_1',
  trial_ends_at: '2026-11-16T18:28:00Z',
};

describe('AdminWriteService.setTrialEnd', () => {
  it('Stripe trial: moves trial_end on Stripe without proration, syncs our row from Stripe, audits', async () => {
    const newEnd = Date.parse('2026-11-30T17:00:00Z') / 1000;
    const subUpdate = jest.fn().mockResolvedValue({ status: 'trialing', trial_end: newEnd });
    const { service, updates, audit } = setup(TRIALING_STRIPE, subUpdate);

    const r = await service.setTrialEnd({
      operatorId: 'op_1',
      trialEndsAt: '2026-11-30T12:00:00-05:00',
      reason: 'extra week for onboarding',
      actor: ACTOR,
      now: NOW,
    });

    expect(subUpdate).toHaveBeenCalledWith('sub_1', { trial_end: newEnd, proration_behavior: 'none' });
    expect(r).toEqual({ trial_ends_at: '2026-11-30T17:00:00.000Z', applied_to: 'stripe' });
    expect(updates).toEqual([{ trial_ends_at: '2026-11-30T17:00:00.000Z' }]);
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'subscription.trial_end_changed',
        metadata: expect.objectContaining({
          previous_trial_ends_at: '2026-11-16T18:28:00Z',
          new_trial_ends_at: '2026-11-30T17:00:00.000Z',
          applied_to: 'stripe',
          reason: 'extra week for onboarding',
        }),
      }),
    );
  });

  it('comped trial (no subscription): updates only our row', async () => {
    const { service, updates, subUpdate } = setup({
      id: 'op_2',
      subscription_status: 'trialing',
      stripe_subscription_id: null,
      trial_ends_at: '2027-10-26T00:00:00Z',
    });
    const r = await service.setTrialEnd({
      operatorId: 'op_2',
      trialEndsAt: '2027-12-31T05:00:00Z',
      reason: 'comp extended',
      actor: ACTOR,
      now: NOW,
    });
    expect(subUpdate).not.toHaveBeenCalled();
    expect(r.applied_to).toBe('comped');
    expect(updates).toEqual([{ trial_ends_at: '2027-12-31T05:00:00.000Z' }]);
  });

  it('refuses an operator that is not in a trial', async () => {
    const { service, subUpdate } = setup({ ...TRIALING_STRIPE, subscription_status: 'active' });
    await expect(
      service.setTrialEnd({ operatorId: 'op_1', trialEndsAt: '2026-11-30T17:00:00Z', reason: 'x', actor: ACTOR, now: NOW }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(subUpdate).not.toHaveBeenCalled();
  });

  it('refuses a time less than an hour away, or more than 730 days out', async () => {
    const { service, subUpdate } = setup(TRIALING_STRIPE);
    await expect(
      service.setTrialEnd({ operatorId: 'op_1', trialEndsAt: '2026-11-09T20:30:00Z', reason: 'x', actor: ACTOR, now: NOW }),
    ).rejects.toThrow(/at least an hour/);
    await expect(
      service.setTrialEnd({ operatorId: 'op_1', trialEndsAt: '2028-12-01T00:00:00Z', reason: 'x', actor: ACTOR, now: NOW }),
    ).rejects.toThrow(/730 days/);
    expect(subUpdate).not.toHaveBeenCalled();
  });

  it('fails loudly (no DB write, no audit) when Stripe ends the trial instead', async () => {
    const subUpdate = jest.fn().mockResolvedValue({ status: 'active', trial_end: null });
    const { service, updates, audit } = setup(TRIALING_STRIPE, subUpdate);
    await expect(
      service.setTrialEnd({ operatorId: 'op_1', trialEndsAt: '2026-11-30T17:00:00Z', reason: 'x', actor: ACTOR, now: NOW }),
    ).rejects.toThrow(/did not keep the subscription in trial/);
    expect(updates).toEqual([]);
    expect(audit.write).not.toHaveBeenCalled();
  });
});
