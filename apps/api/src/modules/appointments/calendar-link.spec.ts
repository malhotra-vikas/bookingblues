import {
  buildIcs,
  calendarLandingHtml,
  calendarUnavailableHtml,
  describeWhen,
  eventForAppointment,
  googleCalendarUrl,
  icsDateTime,
  opensIcsNatively,
} from './calendar-link';

// Prod 2026-11-09: "the calendar link mostly doesn't work". The .ics said
// DTSTART:20261117T140000+0000 (invalid; RFC 5545 needs ...Z), and Android
// often just downloads a .ics.

const appt = {
  id: '69cd3593-6772-40ac-afa2-6a57224408b8',
  jobSummary: 'Medicare plan review',
  // Exactly what Supabase returns for timestamptz.
  startIso: '2026-11-17T14:00:00+00:00',
  endIso: '2026-11-17T15:00:00+00:00',
  serviceAddress: null,
};
const insurance = { businessName: 'Jamal Insurance', timezone: 'America/New_York', office: true };
const plumbing = { businessName: 'Zeus Plumbing', timezone: 'America/New_York', office: false };

describe('icsDateTime', () => {
  it('turns the DB timestamp into the RFC 5545 UTC form', () => {
    expect(icsDateTime('2026-11-17T14:00:00+00:00')).toBe('20261117T140000Z');
    expect(icsDateTime('2026-11-17T09:00:00-05:00')).toBe('20261117T140000Z');
    expect(icsDateTime('2026-11-17T14:00:00.000Z')).toBe('20261117T140000Z');
  });
});

describe('buildIcs', () => {
  const ics = buildIcs(eventForAppointment(appt, insurance), '2026-11-10T02:25:24.123Z');

  it('uses valid UTC date-times (the prod bug)', () => {
    expect(ics).toContain('\r\nDTSTART:20261117T140000Z\r\n');
    expect(ics).toContain('\r\nDTEND:20261117T150000Z\r\n');
    expect(ics).toContain('\r\nDTSTAMP:20261110T022524Z\r\n');
    expect(ics).not.toMatch(/\+0000/);
  });

  it('is CRLF-terminated, keeps the stable UID, and no line exceeds 75 octets', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('UID:69cd3593-6772-40ac-afa2-6a57224408b8@bookingblues');
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
  });

  it('insurance: a call with the business, the window in the description, never the caller number', () => {
    expect(ics).toContain('SUMMARY:Call with Jamal Insurance');
    expect(ics).toContain('LOCATION:Phone call from Jamal Insurance');
    expect(ics.replace(/\r\n /g, '')).toContain('anytime between 9:00 AM and 10:00 AM.');
    expect(ics).not.toContain('+1848');
  });

  it('trades: the service address as location when known, none otherwise', () => {
    expect(buildIcs(eventForAppointment({ ...appt, serviceAddress: '12 Main St, Lenox MA' }, plumbing))).toContain(
      'LOCATION:12 Main St\\, Lenox MA',
    );
    expect(buildIcs(eventForAppointment(appt, plumbing))).not.toContain('LOCATION');
  });
});

describe('Google Calendar link', () => {
  it('pre-fills title, UTC dates and details', () => {
    const url = new URL(googleCalendarUrl(eventForAppointment(appt, insurance)));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe('Call with Jamal Insurance');
    expect(url.searchParams.get('dates')).toBe('20261117T140000Z/20261117T150000Z');
    expect(url.searchParams.get('location')).toBe('Phone call from Jamal Insurance');
  });
});

describe('which phones get the .ics directly', () => {
  it('iPhone / iPad open the .ics; Android and desktop get the page', () => {
    expect(opensIcsNatively('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15')).toBe(true);
    expect(opensIcsNatively('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe(true);
    expect(opensIcsNatively('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130.0 Mobile')).toBe(false);
    expect(opensIcsNatively('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0')).toBe(false);
    expect(opensIcsNatively(undefined)).toBe(false);
  });
});

describe('pages', () => {
  it('landing page: when, both buttons, HTML-escaped', () => {
    const page = calendarLandingHtml({
      businessName: 'Tom & Jerry <Plumbing>',
      when: describeWhen(appt.startIso, appt.endIso, 'America/New_York'),
      callNote: null,
      googleUrl: 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=x',
      icsUrl: 'https://api.keeprsteady.com/v1/appointments/x.ics',
    });
    expect(page).toContain('Tue, Nov 17, 9:00 AM – 10:00 AM');
    expect(page).toContain('Add to Google Calendar');
    expect(page).toContain('Apple Calendar / Outlook (download)');
    expect(page).toContain('Tom &amp; Jerry &lt;Plumbing&gt;');
    expect(page).toContain('action=TEMPLATE&amp;text=x');
  });

  it('unavailable page names the business and its number', () => {
    const page = calendarUnavailableHtml({ businessName: 'Jamal Insurance', phoneE164: '+18632505262' });
    expect(page).toContain("This appointment isn't available");
    expect(page).toContain('cancelled or moved');
    expect(page).toContain('call (863) 250-5262');
  });
});
