/**
 * "Add to your calendar" for the caller (the link in the confirmation SMS).
 * Pure builders; the controllers only load data and send these.
 *
 * Prod 2026-11-09: the link "mostly didn't work". The .ics wrote
 * `DTSTART:20261117T140000+0000` (the DB's `+00:00` with punctuation stripped);
 * RFC 5545 only allows `…T140000Z` (UTC) or a TZID form, so iPhone Calendar
 * refused the file. Android also often just downloads a .ics without opening a
 * calendar, so non-iPhones get a small page with Google Calendar + .ics buttons.
 */
import { callWindowFor, formatUsPhone } from '../conversations/templates/sms-templates';

export interface CalendarEvent {
  /** Stable per appointment, so re-adding after a reschedule updates the same event. */
  readonly uid: string;
  readonly title: string;
  readonly description: string;
  readonly location: string | null;
  readonly startIso: string;
  readonly endIso: string;
}

/** `2026-11-17T14:00:00+00:00` (any offset) → `20261117T140000Z`, the RFC 5545 UTC form. */
export function icsDateTime(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** RFC 5545 §3.1: lines over 75 octets are folded (CRLF + one space). */
function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const len = Buffer.byteLength(ch, 'utf8');
    if (size + len > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += len;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function buildIcs(ev: CalendarEvent, nowIso: string = new Date().toISOString()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//KeeprSteady//Appointments//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${ev.uid}`,
    `DTSTAMP:${icsDateTime(nowIso)}`,
    `DTSTART:${icsDateTime(ev.startIso)}`,
    `DTEND:${icsDateTime(ev.endIso)}`,
    `SUMMARY:${icsEscape(ev.title)}`,
    `DESCRIPTION:${icsEscape(ev.description)}`,
    ...(ev.location ? [`LOCATION:${icsEscape(ev.location)}`] : []),
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/** Google Calendar "create event" link, pre-filled (works on any phone with a browser). */
export function googleCalendarUrl(ev: CalendarEvent): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title,
    dates: `${icsDateTime(ev.startIso)}/${icsDateTime(ev.endIso)}`,
    details: ev.description,
    ...(ev.location ? { location: ev.location } : {}),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export interface AppointmentForCalendar {
  readonly id: string;
  readonly jobSummary: string | null;
  readonly startIso: string;
  readonly endIso: string;
  readonly serviceAddress: string | null;
}

export interface OperatorForCalendar {
  readonly businessName: string;
  readonly timezone: string;
  /** Office (insurance) appointments are phone calls in a window. */
  readonly office: boolean;
}

/**
 * The event as the caller should see it. Office appointments are calls: the
 * title and location say so and the description gives the call window. Trades
 * use the service address as the location when we have it (never the caller's
 * own phone number, which the old file put there).
 */
export function eventForAppointment(appt: AppointmentForCalendar, op: OperatorForCalendar): CalendarEvent {
  const summary = appt.jobSummary?.trim() || 'Appointment';
  // The UID's domain stays `@bookingblues`: changing it would make calendars
  // treat a re-added event as a new one (duplicates after a reschedule).
  const uid = `${appt.id}@bookingblues`;
  if (op.office) {
    const w = callWindowFor(appt.startIso, appt.endIso, op.timezone);
    return {
      uid,
      title: `Call with ${op.businessName}`,
      description: `${summary}\n${op.businessName} will call you at your number anytime between ${w.from} and ${w.to}.`,
      location: `Phone call from ${op.businessName}`,
      startIso: appt.startIso,
      endIso: appt.endIso,
    };
  }
  return {
    uid,
    title: `${op.businessName} appointment`,
    description: summary,
    location: appt.serviceAddress?.trim() || null,
    startIso: appt.startIso,
    endIso: appt.endIso,
  };
}

/** iPhone / iPad Safari opens a .ics straight into Calendar, so skip the page there. */
export function opensIcsNatively(userAgent: string | undefined): boolean {
  return /\b(iPhone|iPad|iPod)\b/.test(userAgent ?? '');
}

/** "Tue, Nov 17, 9:00 AM – 10:00 AM" in the operator's timezone. */
export function describeWhen(startIso: string, endIso: string, timeZone: string): string {
  const day = new Date(startIso).toLocaleString('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' });
  const time = (iso: string): string =>
    new Date(iso).toLocaleString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
  return `${day}, ${time(startIso)} – ${time(endIso)}`;
}

function html(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${html(title)}</title>
<style>
  body{margin:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#0f172a}
  main{max-width:420px;margin:0 auto;padding:32px 20px}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:24px}
  .brand{font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#6B3FA0;margin:0 0 12px}
  h1{font-size:20px;margin:0 0 6px}
  p{font-size:15px;line-height:1.5;color:#475569;margin:0 0 14px}
  .btn{display:block;text-align:center;text-decoration:none;font-weight:600;font-size:16px;border-radius:10px;padding:14px;margin-top:10px}
  .primary{background:#6B3FA0;color:#fff}
  .secondary{background:#fff;color:#6B3FA0;border:1px solid #d8c8ef}
  .small{font-size:12px;color:#94a3b8;margin-top:16px}
</style></head>
<body><main><div class="card">${body}</div></main></body></html>`;
}

/** Android / desktop: one tap to Google Calendar, or the .ics for Apple / Outlook. */
export function calendarLandingHtml(args: {
  businessName: string;
  when: string;
  callNote: string | null;
  googleUrl: string;
  icsUrl: string;
}): string {
  return page(
    `Add your ${args.businessName} appointment`,
    `<p class="brand">${html(args.businessName)}</p>
<h1>Add your appointment to your calendar</h1>
<p><strong>${html(args.when)}</strong>${args.callNote ? `<br>${html(args.callNote)}` : ''}</p>
<a class="btn primary" href="${html(args.googleUrl)}">Add to Google Calendar</a>
<a class="btn secondary" href="${html(args.icsUrl)}">Apple Calendar / Outlook (download)</a>
<p class="small">Need to change it? Reply to our text message.</p>`,
  );
}

/** The appointment was cancelled or no longer exists (instead of a raw 404). */
export function calendarUnavailableHtml(args: { businessName: string | null; phoneE164: string | null }): string {
  const who = args.businessName ?? 'the business';
  const phone = formatUsPhone(args.phoneE164);
  return page(
    'Appointment not available',
    `${args.businessName ? `<p class="brand">${html(args.businessName)}</p>` : ''}
<h1>This appointment isn't available</h1>
<p>It may have been cancelled or moved to a new time. Check the latest text from ${html(who)}, or reply to it to book a time${phone ? `, or call ${html(phone)}` : ''}.</p>`,
  );
}
