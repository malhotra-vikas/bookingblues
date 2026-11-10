import type { PinoLogger } from 'nestjs-pino';

import { ValidationError } from '../../common/errors/app-error';
import { formatUpcomingAppointmentsForPrompt, type CallerJob } from '../appointments/caller-history';
import { changedDetailLabels } from '../appointments/intake-answers';
import { returningCallerOpeningSms } from '../conversations/templates/sms-templates';
import { toolDefinitionsFor } from './tool-definitions';
import { updateAppointmentDetails } from './tool-handlers';
import type { ToolContext } from './tool-handlers';

// Item 6 (2026-11-09): a caller with an upcoming appointment who calls or
// texts again is asked whether it's about that appointment before any intake;
// they can reschedule (bot), cancel (handed to the team) or correct details (bot).

const APPT_ID = '69cd3593-6772-40ac-afa2-6a57224408b8';

describe('missed call from someone with an upcoming appointment', () => {
  it('opening text names the appointment and asks what it is about', () => {
    const sms = returningCallerOpeningSms('Jamal Insurance', 'Tue, Nov 10, 9:00 AM');
    expect(sms).toContain('We see your appointment on Tue, Nov 10, 9:00 AM.');
    expect(sms).toContain('Is this about that appointment (to reschedule or change something), or something new?');
    expect(sms).toContain('Reply STOP to opt out.'); // first message of the conversation
  });
});

describe('UPCOMING APPOINTMENTS prompt block', () => {
  const job: CallerJob = {
    id: APPT_ID,
    conversationId: 'c1',
    status: 'confirmed',
    jobSummary: 'Medicare plan review',
    scheduledForStart: '2026-11-10T14:00:00Z',
    feeStatus: 'none',
    serviceAddress: null,
    createdAt: '2026-11-09T23:56:00Z',
  };
  const now = Date.parse('2026-11-09T20:00:00Z');

  it('asks first when intent is unclear, and skips intake for appointment changes', () => {
    const block = formatUpcomingAppointmentsForPrompt([job], 'America/New_York', now, { office: true })!;
    expect(block).toContain('ask FIRST');
    expect(block).toContain('Do not start the intake questions for a change to an existing appointment.');
  });

  it('cancellation is handed to the team, never claimed as done', () => {
    const block = formatUpcomingAppointmentsForPrompt([job], 'America/New_York', now, { office: true })!;
    expect(block).toContain('call escalate_to_human with the reason "caller wants to cancel');
    expect(block).toContain('Never say it is already cancelled.');
  });

  it('office categories can update details; trades are not offered that tool', () => {
    expect(formatUpcomingAppointmentsForPrompt([job], 'America/New_York', now, { office: true })).toContain(
      'call update_appointment_details',
    );
    expect(formatUpcomingAppointmentsForPrompt([job], 'America/New_York', now, { office: false })).not.toContain(
      'update_appointment_details',
    );
    const names = (c: string): string[] =>
      toolDefinitionsFor(c).map((t) => (t.type === 'function' ? t.function.name : ''));
    expect(names('insurance')).toContain('update_appointment_details');
    expect(names('plumbing')).not.toContain('update_appointment_details');
  });
});

describe('update_appointment_details', () => {
  function makeCtx(updateDetails: jest.Mock, category = 'insurance'): ToolContext {
    return {
      operator: { id: 'op_1', category, timezone: 'America/New_York' } as unknown as ToolContext['operator'],
      conversation: { id: 'conv_2' } as unknown as ToolContext['conversation'],
      callerPhoneE164: '+18483458488',
      supabase: {} as never,
      calendar: {} as never,
      twilio: {} as never,
      conversations: {} as never,
      payments: {} as never,
      escalations: {} as never,
      handoffNotifier: {} as never,
      bookings: { updateDetails } as unknown as ToolContext['bookings'],
      intakeAnswers: {} as never,
      logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } as unknown as PinoLogger,
    };
  }

  it('updates the same appointment and reports which fields changed', async () => {
    const updateDetails = jest.fn().mockResolvedValue({
      answers: { first_name: 'Varsha', date_of_birth: '1943', prescriptions: [] },
      changed: ['Date of birth'],
    });
    const r = await updateAppointmentDetails({ appointment_id: APPT_ID, date_of_birth: '1943' }, makeCtx(updateDetails));
    expect(updateDetails).toHaveBeenCalledWith(
      expect.objectContaining({ appointmentId: APPT_ID, callerPhoneE164: '+18483458488' }),
    );
    expect(r.content).toEqual({ updated: ['Date of birth'] });
    expect(r.state).toBeUndefined(); // conversation stays open for anything else
  });

  it('refuses when nothing changed, for trades, and for an appointment that is not theirs', async () => {
    const updateDetails = jest.fn().mockRejectedValue(new ValidationError('No upcoming confirmed appointment'));
    expect((await updateAppointmentDetails({ appointment_id: APPT_ID }, makeCtx(updateDetails))).content).toMatchObject({
      error: 'nothing_to_update',
    });
    expect(
      (await updateAppointmentDetails({ appointment_id: APPT_ID, doctor: 'Dr Lee' }, makeCtx(updateDetails, 'plumbing'))).content,
    ).toMatchObject({ error: 'not_available' });
    expect(
      (await updateAppointmentDetails({ appointment_id: APPT_ID, doctor: 'Dr Lee' }, makeCtx(updateDetails))).content,
    ).toMatchObject({ error: 'invalid_request' });
  });

  it('the operator email gets field labels only, never values', () => {
    expect(
      changedDetailLabels({ appointment_id: APPT_ID, date_of_birth: '1943', doctor: 'Dr Lee', caller_email: 'a@b.co' }),
    ).toEqual(['Date of birth', 'Doctor / office', 'Email']);
  });
});
