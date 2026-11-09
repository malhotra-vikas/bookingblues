import type { PinoLogger } from 'nestjs-pino';

import { checkAvailability } from './tool-handlers';
import type { ToolContext } from './tool-handlers';

// Prod 2026-11-09 4:30 PM ET: the bot offered "today at 4:30pm". Availability
// must mark everything before now + 2h as unavailable and say so.

function makeCtx(): ToolContext {
  const q: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'eq', 'in', 'lt', 'gt']) q[m] = () => q;
  q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  return {
    operator: {
      id: 'op_1',
      category: 'insurance',
      timezone: 'America/New_York',
      truck_count: 1,
      business_hours: {},
    } as unknown as ToolContext['operator'],
    conversation: { id: 'conv_1' } as unknown as ToolContext['conversation'],
    callerPhoneE164: '+15555550002',
    supabase: { db: () => q } as unknown as ToolContext['supabase'],
    calendar: { getConnection: jest.fn().mockResolvedValue({ status: 'active' }) } as unknown as ToolContext['calendar'],
    twilio: {} as never,
    conversations: {} as never,
    payments: {} as never,
    escalations: {} as never,
    handoffNotifier: {} as never,
    bookings: {} as never,
    intakeAnswers: {} as never,
    logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } as unknown as PinoLogger,
  };
}

describe('check_availability minimum notice', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-09T21:30:00Z')); // 4:30 PM ET
  });
  afterEach(() => jest.useRealTimers());

  it('blocks the next 2 hours and reports the earliest bookable time', async () => {
    const r = await checkAvailability(
      { window_start: '2026-11-09T09:00', window_end: '2026-11-10T20:00' },
      makeCtx(),
    );
    const c = r.content as { earliest_bookable: string; earliest_bookable_rule: string; busy: Array<Record<string, string>> };
    expect(c.earliest_bookable).toBe('2026-11-09T18:30');
    expect(c.earliest_bookable_rule).toContain('Never offer or book a start before');
    expect(c.busy[0]).toEqual({ start: '2026-11-09T09:00', end: '2026-11-09T18:30', reason: 'too_soon' });
  });

  it('adds no too-soon block when the window starts after the notice period', async () => {
    const r = await checkAvailability(
      { window_start: '2026-11-12T09:00', window_end: '2026-11-12T17:00' },
      makeCtx(),
    );
    const c = r.content as { busy: Array<Record<string, string>> };
    expect(c.busy.some((b) => b.reason === 'too_soon')).toBe(false);
  });
});
