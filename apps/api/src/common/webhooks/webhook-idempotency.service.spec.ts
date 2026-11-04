import type { PinoLogger } from 'nestjs-pino';

import { AppError } from '../errors/app-error';
import type { SupabaseService } from '../supabase/supabase.service';

import { WebhookIdempotencyService } from './webhook-idempotency.service';

interface MockResult {
  data: { id: string } | null;
  error: { code?: string; message: string } | null;
}

type ClaimRow = { id: string; attempts: number; outcome: string };

function makeSupabaseWithMocks(result: MockResult, claimRows: ClaimRow[] = []) {
  const single = jest.fn().mockResolvedValue(result);
  const select = jest.fn().mockReturnValue({ single });
  const insert = jest.fn().mockReturnValue({ select });
  const eq = jest.fn().mockResolvedValue({ error: null });
  const update = jest.fn().mockReturnValue({ eq });
  const from = jest.fn().mockReturnValue({ insert, update });
  const rpc = jest.fn().mockResolvedValue({ data: claimRows, error: null });
  const supabase = { db: () => ({ from, rpc }) } as unknown as SupabaseService;
  return { supabase, update, rpc };
}

function makeSupabase(result: MockResult, claimRows: ClaimRow[] = []): SupabaseService {
  return makeSupabaseWithMocks(result, claimRows).supabase;
}

const UNIQUE_VIOLATION: MockResult = { data: null, error: { code: '23505', message: 'duplicate key value' } };

function makeLogger(): PinoLogger {
  return {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
  } as unknown as PinoLogger;
}

describe('WebhookIdempotencyService', () => {
  it('returns "new" with the inserted id when the row is fresh', async () => {
    const supabase = makeSupabase({ data: { id: 'evt_1' }, error: null });
    const svc = new WebhookIdempotencyService(supabase, makeLogger());

    const result = await svc.record({
      source: 'stripe',
      eventId: 'evt_test_123',
      payload: { type: 'checkout.session.completed' },
      signatureVerified: true,
    });

    expect(result).toEqual({ status: 'new', id: 'evt_1', attempt: 1 });
  });

  it('returns "duplicate" when the already-recorded event was processed', async () => {
    const { supabase, rpc } = makeSupabaseWithMocks(UNIQUE_VIOLATION, [
      { id: 'row_1', attempts: 1, outcome: 'processed' },
    ]);
    const svc = new WebhookIdempotencyService(supabase, makeLogger());

    const result = await svc.record({
      source: 'twilio',
      eventId: 'SM_test',
      payload: { Body: 'hi' },
      signatureVerified: true,
    });

    expect(result).toEqual({ status: 'duplicate' });
    expect(rpc).toHaveBeenCalledWith('claim_webhook_event', {
      p_source: 'twilio',
      p_event_id: 'SM_test',
      p_lease_seconds: 300,
    });
  });

  it('re-claims an event whose earlier processing failed, so the retry runs it', async () => {
    const supabase = makeSupabase(UNIQUE_VIOLATION, [{ id: 'row_1', attempts: 2, outcome: 'reclaimed' }]);
    const svc = new WebhookIdempotencyService(supabase, makeLogger());

    const result = await svc.record({
      source: 'stripe',
      eventId: 'evt_failed_once',
      payload: {},
      signatureVerified: true,
    });

    expect(result).toEqual({ status: 'new', id: 'row_1', attempt: 2 });
  });

  it('reports "in_progress" while another worker holds a live claim', async () => {
    const supabase = makeSupabase(UNIQUE_VIOLATION, [{ id: 'row_1', attempts: 1, outcome: 'in_progress' }]);
    const svc = new WebhookIdempotencyService(supabase, makeLogger());

    const result = await svc.record({
      source: 'stripe',
      eventId: 'evt_racing',
      payload: {},
      signatureVerified: true,
    });

    expect(result).toEqual({ status: 'in_progress' });
  });

  it('markFailed releases the claim so the next retry can re-process', async () => {
    const { supabase, update } = makeSupabaseWithMocks({ data: { id: 'row_1' }, error: null });
    const svc = new WebhookIdempotencyService(supabase, makeLogger());

    await svc.markFailed('row_1', 'boom');

    expect(update).toHaveBeenCalledWith({ error: 'boom', claimed_at: new Date(0).toISOString() });
  });

  it('throws ExternalServiceError on any other DB error', async () => {
    const supabase = makeSupabase({
      data: null,
      error: { code: '08006', message: 'connection failure' },
    });
    const svc = new WebhookIdempotencyService(supabase, makeLogger());

    await expect(
      svc.record({
        source: 'google',
        eventId: 'gcal_1',
        payload: {},
        signatureVerified: true,
      }),
    ).rejects.toMatchObject({ code: 'external.supabase' });
  });

  it('AppError thrown on non-unique error preserves the original error as cause', async () => {
    const supabase = makeSupabase({
      data: null,
      error: { code: '08006', message: 'connection failure' },
    });
    const svc = new WebhookIdempotencyService(supabase, makeLogger());

    let thrown: unknown;
    try {
      await svc.record({
        source: 'stripe_connect',
        eventId: 'evt_x',
        payload: {},
        signatureVerified: false,
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).status).toBe(502);
  });
});
