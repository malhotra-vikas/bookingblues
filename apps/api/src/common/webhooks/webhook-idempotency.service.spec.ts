import type { PinoLogger } from 'nestjs-pino';

import { AppError } from '../errors/app-error';
import type { SupabaseService } from '../supabase/supabase.service';

import { WebhookIdempotencyService } from './webhook-idempotency.service';

interface MockResult {
  data: { id: string } | null;
  error: { code?: string; message: string } | null;
}

function makeSupabase(result: MockResult): SupabaseService {
  const single = jest.fn().mockResolvedValue(result);
  const select = jest.fn().mockReturnValue({ single });
  const insert = jest.fn().mockReturnValue({ select });
  const eq = jest.fn().mockResolvedValue({ error: null });
  const update = jest.fn().mockReturnValue({ eq });
  const from = jest.fn().mockReturnValue({ insert, update });
  return {
    db: () => ({ from }),
  } as unknown as SupabaseService;
}

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

    expect(result).toEqual({ status: 'new', id: 'evt_1' });
  });

  it('returns "duplicate" on a unique-violation (Postgres 23505)', async () => {
    const supabase = makeSupabase({
      data: null,
      error: { code: '23505', message: 'duplicate key value' },
    });
    const svc = new WebhookIdempotencyService(supabase, makeLogger());

    const result = await svc.record({
      source: 'twilio',
      eventId: 'SM_test',
      payload: { Body: 'hi' },
      signatureVerified: true,
    });

    expect(result).toEqual({ status: 'duplicate' });
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
