import {
  formatCallerJobsForPrompt,
  formatCallerJobsForSlack,
  hasActiveBooking,
  type CallerJob,
} from './caller-history';

const TZ = 'America/New_York';

function job(partial: Partial<CallerJob>): CallerJob {
  return {
    id: 'a1',
    conversationId: 'c1',
    status: 'confirmed',
    jobSummary: 'sump pump install',
    scheduledForStart: '2026-07-01T14:30:00.000Z', // 10:30 AM ET
    feeStatus: 'paid',
    serviceAddress: '162 Main St, Edison',
    createdAt: '2026-06-30T00:00:00.000Z',
    ...partial,
  };
}

describe('formatCallerJobsForPrompt', () => {
  it('returns null when the caller has no jobs', () => {
    expect(formatCallerJobsForPrompt([], TZ)).toBeNull();
  });

  it('omits cancelled jobs and returns null when only cancelled remain', () => {
    expect(formatCallerJobsForPrompt([job({ status: 'cancelled' })], TZ)).toBeNull();
  });

  it('lists jobs and instructs the bot to escalate for existing-job talk', () => {
    const out = formatCallerJobsForPrompt([job({})], TZ)!;
    expect(out).toContain('CALLER HISTORY');
    expect(out).toContain('sump pump install');
    expect(out).toContain('confirmed');
    expect(out).toContain('deposit paid');
    expect(out).toContain('escalate_to_human');
    // Renders the time in the operator's timezone, not UTC.
    expect(out).toContain('10:30');
  });

  it('marks unpaid deposits distinctly', () => {
    const out = formatCallerJobsForPrompt([job({ feeStatus: 'pending' })], TZ)!;
    expect(out).toContain('deposit unpaid');
  });
});

describe('formatCallerJobsForSlack', () => {
  it('returns null with no jobs', () => {
    expect(formatCallerJobsForSlack([], TZ)).toBeNull();
  });

  it('includes a count, the address, and every job (even cancelled)', () => {
    const out = formatCallerJobsForSlack([job({}), job({ id: 'a2', status: 'cancelled' })], TZ)!;
    expect(out).toContain('Caller job history (2)');
    expect(out).toContain('162 Main St, Edison');
    expect(out).toContain('cancelled');
  });
});

describe('hasActiveBooking', () => {
  it('is true for a confirmed or completed job', () => {
    expect(hasActiveBooking([job({ status: 'confirmed' })])).toBe(true);
    expect(hasActiveBooking([job({ status: 'completed' })])).toBe(true);
  });
  it('is false for only proposed/cancelled/no_show', () => {
    expect(hasActiveBooking([job({ status: 'proposed' }), job({ status: 'cancelled' })])).toBe(false);
  });
});
