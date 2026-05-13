import type { Tables } from '@bookingblues/db-types';

type OperatorRow = Tables<'operators'>;
type MessageRow = Tables<'messages'>;

export interface BookingSummaryArgs {
  readonly operator: OperatorRow;
  readonly appointment: {
    readonly id: string;
    readonly caller_name: string;
    readonly caller_phone_e164: string;
    readonly caller_email: string | null;
    readonly job_summary: string;
    readonly scheduled_for_start: string;
    readonly scheduled_for_end: string;
    readonly fee_cents: number | null;
    readonly fee_status: string;
  };
  readonly transcript: ReadonlyArray<Pick<MessageRow, 'role' | 'body' | 'created_at'>>;
  readonly googleEventUrl: string | null;
  readonly platformAppUrl: string;
}

export interface DailySummaryArgs {
  readonly operator: OperatorRow;
  readonly summaryDate: string;          // YYYY-MM-DD in operator timezone
  readonly conversationsStarted: number;
  readonly conversationsBooked: number;
  readonly conversationsEscalated: number;
  readonly conversationsAbandoned: number;
  readonly appointmentsToday: ReadonlyArray<{
    readonly caller_name: string;
    readonly scheduled_for_start: string;
    readonly job_summary: string;
  }>;
  readonly feeRevenueCents: number;
  readonly platformAppUrl: string;
}

function formatTime(iso: string, tz: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
function formatE164(e164: string): string {
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}
function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLE_BASE = `
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px; line-height: 1.5; color: #0f172a;
`;

/**
 * Per-booking summary email. Sent to operator right after a booking lands —
 * gives them the caller details, job, time, fee status, and the full SMS
 * transcript so they have context before showing up.
 *
 * Light-mode-locked (Gmail dark-mode is unreliable for transactional mail).
 */
export function renderBookingSummary(args: BookingSummaryArgs): { subject: string; html: string; text: string } {
  const a = args.appointment;
  const tz = args.operator.timezone;
  const callerLine = a.caller_email ? `${a.caller_name} · ${formatE164(a.caller_phone_e164)} · ${a.caller_email}` : `${a.caller_name} · ${formatE164(a.caller_phone_e164)}`;
  const feeLine =
    a.fee_cents != null
      ? `${dollars(a.fee_cents)} (${a.fee_status})`
      : 'No fee';

  const transcriptRows = args.transcript
    .filter((m) => m.role === 'caller' || m.role === 'bot')
    .map((m) => {
      const who = m.role === 'caller' ? a.caller_name : `${args.operator.business_name} AI`;
      const t = new Date(m.created_at).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
      const bg = m.role === 'caller' ? '#f1f5f9' : '#eff6ff';
      return `
        <tr>
          <td style="padding: 8px 12px; background:${bg}; border-radius:6px; vertical-align:top;">
            <div style="font-size:11px; color:#64748b; margin-bottom:2px;">${escapeHtml(who)} · ${t}</div>
            <div style="white-space:pre-wrap;">${escapeHtml(m.body ?? '')}</div>
          </td>
        </tr>
        <tr><td style="height:6px;"></td></tr>
      `;
    })
    .join('');

  const html = `
<!doctype html>
<html><body style="margin:0; padding:24px; background:#f8fafc;">
  <div style="${STYLE_BASE} max-width:640px; margin:0 auto; background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:24px;">
    <h2 style="margin:0 0 4px 0; font-size:18px;">📅 New booking — ${escapeHtml(a.caller_name)}</h2>
    <p style="color:#64748b; margin:0 0 20px 0;">${escapeHtml(args.operator.business_name)}</p>

    <table cellpadding="0" cellspacing="0" style="width:100%; border-collapse:collapse; margin-bottom:18px;">
      <tr><td style="padding:6px 0; color:#64748b; width:140px;">When</td><td style="padding:6px 0; font-weight:600;">${formatTime(a.scheduled_for_start, tz)}</td></tr>
      <tr><td style="padding:6px 0; color:#64748b;">Caller</td><td style="padding:6px 0;">${escapeHtml(callerLine)}</td></tr>
      <tr><td style="padding:6px 0; color:#64748b;">Job</td><td style="padding:6px 0;">${escapeHtml(a.job_summary)}</td></tr>
      <tr><td style="padding:6px 0; color:#64748b;">Fee</td><td style="padding:6px 0;">${feeLine}</td></tr>
    </table>

    ${args.googleEventUrl ? `<p><a href="${escapeHtml(args.googleEventUrl)}" style="display:inline-block; padding:8px 14px; background:#0b5cd6; color:#fff; text-decoration:none; border-radius:6px; font-weight:600;">Open in Google Calendar</a></p>` : ''}

    <h3 style="margin:24px 0 8px 0; font-size:14px;">Conversation transcript</h3>
    <table cellpadding="0" cellspacing="0" style="width:100%; border-collapse:collapse;">
      ${transcriptRows || '<tr><td style="color:#64748b; padding:8px 0;">No transcript available.</td></tr>'}
    </table>

    <p style="margin-top:24px; font-size:12px; color:#64748b;">
      Manage this booking in your <a href="${escapeHtml(args.platformAppUrl)}/dashboard" style="color:#0b5cd6;">BookingBlues dashboard</a>.
    </p>
  </div>
</body></html>`;

  const text =
    `New booking — ${a.caller_name}\n` +
    `${args.operator.business_name}\n\n` +
    `When: ${formatTime(a.scheduled_for_start, tz)}\n` +
    `Caller: ${callerLine}\n` +
    `Job: ${a.job_summary}\n` +
    `Fee: ${feeLine}\n` +
    (args.googleEventUrl ? `\nGoogle Calendar: ${args.googleEventUrl}\n` : '') +
    `\nDashboard: ${args.platformAppUrl}/dashboard\n`;

  return {
    subject: `New booking · ${a.caller_name} · ${formatTime(a.scheduled_for_start, tz)}`,
    html,
    text,
  };
}

/**
 * Daily summary. Sent each morning with yesterday's numbers + today's
 * upcoming appointments. Plain card layout, light-mode-locked.
 */
export function renderDailySummary(args: DailySummaryArgs): { subject: string; html: string; text: string } {
  const tz = args.operator.timezone;
  const dateLabel = new Date(`${args.summaryDate}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  const conversionPct =
    args.conversationsStarted > 0
      ? Math.round((args.conversationsBooked / args.conversationsStarted) * 100)
      : 0;

  const today = args.appointmentsToday
    .map((apt) => `
      <tr>
        <td style="padding:6px 0; color:#64748b; width:140px; white-space:nowrap;">${formatTime(apt.scheduled_for_start, tz)}</td>
        <td style="padding:6px 0;"><strong>${escapeHtml(apt.caller_name)}</strong> — ${escapeHtml(apt.job_summary)}</td>
      </tr>
    `)
    .join('');

  const stat = (label: string, value: string | number): string => `
    <td style="padding:10px; border:1px solid #e2e8f0; border-radius:8px; width:25%; vertical-align:top; background:#fff;">
      <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.04em; color:#64748b;">${label}</div>
      <div style="font-size:22px; font-weight:700; margin-top:4px;">${value}</div>
    </td>
  `;

  const html = `
<!doctype html>
<html><body style="margin:0; padding:24px; background:#f8fafc;">
  <div style="${STYLE_BASE} max-width:640px; margin:0 auto; background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:24px;">
    <h2 style="margin:0 0 4px 0; font-size:18px;">Daily summary — ${escapeHtml(dateLabel)}</h2>
    <p style="color:#64748b; margin:0 0 20px 0;">${escapeHtml(args.operator.business_name)}</p>

    <table cellpadding="0" cellspacing="6" style="width:100%; border-collapse:separate; margin-bottom:18px;">
      <tr>
        ${stat('Conversations', args.conversationsStarted)}
        ${stat('Booked', `${args.conversationsBooked}${args.conversationsStarted > 0 ? ` (${conversionPct}%)` : ''}`)}
        ${stat('Escalated', args.conversationsEscalated)}
        ${stat('Fee revenue', dollars(args.feeRevenueCents))}
      </tr>
    </table>

    <h3 style="margin:20px 0 8px 0; font-size:14px;">Today's appointments</h3>
    ${args.appointmentsToday.length > 0
      ? `<table cellpadding="0" cellspacing="0" style="width:100%; border-collapse:collapse;">${today}</table>`
      : '<p style="color:#64748b;">No appointments scheduled for today.</p>'}

    <p style="margin-top:24px; font-size:12px; color:#64748b;">
      Full numbers in your <a href="${escapeHtml(args.platformAppUrl)}/dashboard" style="color:#0b5cd6;">BookingBlues dashboard</a>.
      ${args.conversationsAbandoned > 0 ? `${args.conversationsAbandoned} caller${args.conversationsAbandoned === 1 ? '' : 's'} stopped responding mid-conversation.` : ''}
    </p>
  </div>
</body></html>`;

  const text =
    `Daily summary — ${dateLabel}\n` +
    `${args.operator.business_name}\n\n` +
    `Conversations: ${args.conversationsStarted}\n` +
    `Booked: ${args.conversationsBooked}${args.conversationsStarted > 0 ? ` (${conversionPct}%)` : ''}\n` +
    `Escalated: ${args.conversationsEscalated}\n` +
    `Abandoned: ${args.conversationsAbandoned}\n` +
    `Fee revenue: ${dollars(args.feeRevenueCents)}\n\n` +
    `Today's appointments:\n` +
    (args.appointmentsToday.length > 0
      ? args.appointmentsToday.map((a) => `  ${formatTime(a.scheduled_for_start, tz)} — ${a.caller_name} (${a.job_summary})`).join('\n')
      : '  (none)') +
    `\n\nDashboard: ${args.platformAppUrl}/dashboard\n`;

  return {
    subject: `BookingBlues daily summary — ${dateLabel}`,
    html,
    text,
  };
}
