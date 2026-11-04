import { formatUpcomingAppointmentsForPrompt, type CallerJob } from '../appointments/caller-history';
import { rescheduleConfirmationSms } from '../conversations/templates/sms-templates';
import { toolDefinitionsFor } from './tool-definitions';

const job = (over: Partial<CallerJob>): CallerJob => ({
  id: 'appt-1',
  conversationId: 'conv-1',
  status: 'confirmed',
  jobSummary: 'Medicare plan review',
  scheduledForStart: '2026-11-08T15:00:00Z',
  feeStatus: 'none',
  serviceAddress: null,
  createdAt: '2026-11-04T20:17:00Z',
  ...over,
});

const NOW = Date.parse('2026-11-04T21:00:00Z');
const names = (category: string) =>
  toolDefinitionsFor(category).map((t) => (t.type === 'function' ? t.function.name : ''));

describe('rescheduling (all categories)', () => {
  it('every category gets reschedule_appointment', () => {
    for (const c of ['insurance', 'plumbing', 'hvac', 'electrical', 'roofing', 'garage_door']) {
      expect(names(c)).toContain('reschedule_appointment');
    }
  });

  it('lists the upcoming appointment with its id and forbids a second booking', () => {
    const block = formatUpcomingAppointmentsForPrompt([job({})], 'America/New_York', NOW)!;
    expect(block).toContain('id appt-1: Sun, Nov 8, 10:00 AM');
    expect(block).toContain('Never book a second appointment to change the time');
    expect(block).toContain('reschedule_appointment');
    // Trades: pending address/deposit steps for the listed appointment continue.
    expect(block).toContain('continue it');
  });

  it('trades: a job still missing its address tells the bot to save the address reply', () => {
    const trade = formatUpcomingAppointmentsForPrompt([job({})], 'America/New_York', NOW, { office: false })!;
    expect(trade).toContain('ADDRESS NOT YET COLLECTED');
    expect(trade).toContain('collect_service_address');
    const done = formatUpcomingAppointmentsForPrompt([job({ serviceAddress: '42 Oak St' })], 'America/New_York', NOW)!;
    expect(done).not.toContain('ADDRESS NOT YET COLLECTED');
    const office = formatUpcomingAppointmentsForPrompt([job({})], 'America/New_York', NOW, { office: true })!;
    expect(office).not.toContain('ADDRESS NOT YET COLLECTED');
  });

  it('office: an extra appointment is escalated; trades: a separate job may be booked', () => {
    const office = formatUpcomingAppointmentsForPrompt([job({})], 'America/New_York', NOW, { office: true })!;
    expect(office).toContain('additional, separate appointment, call escalate_to_human');
    const trade = formatUpcomingAppointmentsForPrompt([job({})], 'America/New_York', NOW, { office: false })!;
    expect(trade).toContain('separate, additional job');
  });

  it('ignores past, cancelled and unconfirmed appointments', () => {
    const jobs = [
      job({ id: 'past', scheduledForStart: '2026-11-01T15:00:00Z' }),
      job({ id: 'cancelled', status: 'cancelled' }),
      job({ id: 'proposed', status: 'proposed' }),
    ];
    expect(formatUpcomingAppointmentsForPrompt(jobs, 'America/New_York', NOW)).toBeNull();
  });

  it('reschedule text says the appointment MOVED and the old time is cancelled', () => {
    const body = rescheduleConfirmationSms({
      businessName: 'Insurance Test',
      friendlyTime: 'Sat, Nov 7, 10:00 AM',
      icsUrl: 'https://api.example.com/cal/abc',
      callerName: 'Vikas M',
      category: 'insurance',
    });
    expect(body).toContain('✅ Vikas, your appointment with Insurance Test has been moved to Sat, Nov 7, 10:00 AM.');
    expect(body).toContain('Your earlier time is cancelled.');
    expect(body).toContain('Please bring your Medicare card');
    expect(body).toContain('Updated calendar link: https://api.example.com/cal/abc');
  });
});
