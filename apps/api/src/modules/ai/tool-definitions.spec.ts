import {
  BookAppointmentArgs,
  CheckAvailabilityArgs,
  ProposeSlotsArgs,
  TOOL_DEFINITIONS,
} from './tool-definitions';

describe('Tool argument schemas', () => {
  it('CheckAvailabilityArgs accepts local wall-clock times', () => {
    const ok = CheckAvailabilityArgs.safeParse({
      window_start: '2026-11-03T09:00',
      window_end: '2026-11-03T17:00:00',
    });
    expect(ok.success).toBe(true);
  });

  it('strips a Z or offset the model adds anyway (wall clock wins)', () => {
    // The model's offset arithmetic is what breaks across DST; the server
    // applies the operator's timezone instead. See calendar/zoned-time.ts.
    const parsed = CheckAvailabilityArgs.safeParse({
      window_start: '2026-11-03T09:00:00-04:00',
      window_end: '2026-11-03T17:00:00.000Z',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.window_start).toBe('2026-11-03T09:00:00');
      expect(parsed.data.window_end).toBe('2026-11-03T17:00:00');
    }
  });

  it('CheckAvailabilityArgs still rejects truly garbage datetimes', () => {
    const bad = CheckAvailabilityArgs.safeParse({
      window_start: 'tomorrow morning',
      window_end: '2026-05-08',
    });
    expect(bad.success).toBe(false);
  });

  it('ProposeSlotsArgs caps at 5 slots', () => {
    const arr = Array.from({ length: 6 }, (_, i) => ({
      start: `2026-05-07T${String(9 + i).padStart(2, '0')}:00:00Z`,
      end: `2026-05-07T${String(10 + i).padStart(2, '0')}:00:00Z`,
    }));
    expect(ProposeSlotsArgs.safeParse({ slots: arr }).success).toBe(false);
  });

  it('BookAppointmentArgs defaults urgency to normal', () => {
    const parsed = BookAppointmentArgs.parse({
      start: '2026-05-07T13:00:00Z',
      end: '2026-05-07T14:00:00Z',
      caller_name: 'Pat',
      job_summary: 'Leaking kitchen sink',
    });
    expect(parsed.urgency).toBe('normal');
  });

  it('exposes the expected tools by name', () => {
    // `request_payment_link` is intentionally not model-exposed — book_appointment
    // now reserves the slot AND sends the payment link itself (Reserve→Pay→Confirm).
    const names = TOOL_DEFINITIONS.map((t) => t.function.name).sort();
    expect(names).toEqual([
      'book_appointment',
      'check_availability',
      'check_service_area',
      'collect_service_address',
      'escalate_to_human',
      'mark_out_of_scope',
      'mark_spam',
      'propose_slots',
    ]);
  });
});
