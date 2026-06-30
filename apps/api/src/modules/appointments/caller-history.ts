import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@bookingblues/db-types';

/**
 * A caller's prior/upcoming jobs with one operator. Powers two things:
 *  1. The AI system prompt — so the bot recognises a caller who already has a
 *     job on file and ESCALATES (instead of double-booking) when they want to
 *     discuss/change/ask about an existing one.
 *  2. The #hitl escalation alarm — so the human picking up has the caller's
 *     full job history (upcoming, in-progress, completed, cancelled) in front
 *     of them, no lookup required.
 *
 * Pure functions (db passed in) so both the AI module and the Slack module can
 * use them without a DI cycle.
 */

export interface CallerJob {
  id: string;
  conversationId: string | null;
  status: string; // proposed | confirmed | cancelled | completed | no_show
  jobSummary: string | null;
  scheduledForStart: string | null;
  feeStatus: string | null;
  serviceAddress: string | null;
  createdAt: string;
}

/**
 * Every appointment this caller has with this operator, newest scheduled
 * first. Keyed on `caller_phone_e164` (denormalised on appointments) so it
 * spans all of the caller's conversations, not just the current one.
 */
export async function fetchCallerJobs(
  db: SupabaseClient<Database>,
  operatorId: string,
  callerPhoneE164: string,
  limit = 10,
): Promise<CallerJob[]> {
  const { data, error } = await db
    .from('appointments')
    .select('id, conversation_id, status, job_summary, scheduled_for_start, fee_status, service_address, created_at')
    .eq('operator_id', operatorId)
    .eq('caller_phone_e164', callerPhoneE164)
    .order('scheduled_for_start', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((a) => ({
    id: a.id,
    conversationId: a.conversation_id,
    status: a.status,
    jobSummary: a.job_summary,
    scheduledForStart: a.scheduled_for_start,
    feeStatus: a.fee_status,
    serviceAddress: a.service_address,
    createdAt: a.created_at,
  }));
}

function formatWhen(iso: string | null, timezone: string): string {
  if (!iso) return 'unscheduled';
  return new Date(iso).toLocaleString('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Jobs that represent a real, still-live booking (not cancelled / no-show). */
function isActiveBooking(j: CallerJob): boolean {
  return j.status === 'confirmed' || j.status === 'completed';
}

function feeNote(j: CallerJob): string {
  if (j.feeStatus === 'paid') return ', deposit paid';
  if (j.feeStatus === 'pending') return ', deposit unpaid';
  return '';
}

/**
 * Compact caller-history block for the AI system prompt. Returns null when the
 * caller has no jobs on file (omit the block entirely rather than confuse the
 * model with an empty list).
 */
export function formatCallerJobsForPrompt(jobs: CallerJob[], timezone: string): string | null {
  const relevant = jobs.filter((j) => j.status !== 'cancelled');
  if (relevant.length === 0) return null;
  const lines = relevant.map(
    (j) =>
      `- ${formatWhen(j.scheduledForStart, timezone)} — "${j.jobSummary ?? 'job'}" — ${j.status}${feeNote(j)}`,
  );
  return [
    'CALLER HISTORY — this caller already has job(s) on file with this operator:',
    ...lines,
    '',
    'You can ONLY book brand-new jobs. You cannot reschedule, cancel, look up, or',
    'modify any existing job. If the caller wants to discuss, change, confirm, or',
    'ask about one of the jobs listed above (rather than book a genuinely new,',
    'separate job), call escalate_to_human with a reason that says they want to',
    'talk about an existing job — the team will take it from there. When unsure',
    'whether it is a new job or an existing one, ask one clarifying question; if',
    'it is about an existing one, escalate.',
  ].join('\n');
}

/**
 * Caller-history context for the #hitl escalation alarm so the human has the
 * full picture. Returns null when there are no jobs on file.
 */
export function formatCallerJobsForSlack(jobs: CallerJob[], timezone: string): string | null {
  if (jobs.length === 0) return null;
  const lines = jobs.map((j) => {
    const addr = j.serviceAddress ? ` @ ${j.serviceAddress}` : '';
    return `• ${formatWhen(j.scheduledForStart, timezone)} — ${j.jobSummary ?? 'job'} — ${j.status}${feeNote(j)}${addr}`;
  });
  return `*Caller job history (${jobs.length}):*\n${lines.join('\n')}`;
}

/** True if any of the caller's jobs is a live booking (confirmed/completed). */
export function hasActiveBooking(jobs: CallerJob[]): boolean {
  return jobs.some(isActiveBooking);
}
