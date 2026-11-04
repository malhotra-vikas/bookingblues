// Test-only preload for the E2E API process (node --require). NEVER used in prod.
//
// Intercepts global fetch calls to Google Calendar, Resend and Slack, answers them
// with canned success responses, and appends every intercepted request to a JSONL
// capture file so the test can assert on emails, calendar events and Slack posts.
// Everything else (Stripe test mode, OpenAI, local Supabase) passes through.

const { appendFileSync } = require('node:fs');

const CAPTURE = process.env.E2E_CAPTURE_FILE;
if (!CAPTURE) throw new Error('fakes.cjs: E2E_CAPTURE_FILE is not set');

const realFetch = globalThis.fetch;
let seq = 0;

function record(kind, url, init) {
  let body = init?.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      /* form-encoded or plain text: keep as string */
    }
  }
  appendFileSync(CAPTURE, JSON.stringify({ kind, url, method: init?.method ?? 'GET', body, at: new Date().toISOString() }) + '\n');
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async function fakeFetch(input, init) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  if (url.startsWith('https://api.resend.com/')) {
    record('email', url, init);
    return json({ id: `e2e_email_${++seq}` });
  }

  if (url.startsWith('https://slack.com/api/')) {
    record('slack', url, init);
    return json({ ok: true, ts: `${Date.now() / 1000}`, channel: 'C_E2E', permalink: 'https://example.invalid/slack' });
  }

  if (url.startsWith('https://oauth2.googleapis.com/token')) {
    record('google_token', url, init);
    return json({ access_token: 'e2e_google_access', expires_in: 3600, token_type: 'Bearer' });
  }

  if (url.startsWith('https://www.googleapis.com/calendar/v3/freeBusy')) {
    record('google_freebusy', url, init);
    return json({ kind: 'calendar#freeBusy', calendars: { primary: { busy: [] } } });
  }

  if (url.startsWith('https://www.googleapis.com/calendar/v3/calendars/')) {
    const method = (init?.method ?? 'GET').toUpperCase();
    record(`google_event_${method.toLowerCase()}`, url, init);
    if (method === 'DELETE') return new Response(null, { status: 204 });
    const id = `e2eevt${++seq}`;
    return json({ id, status: 'confirmed', htmlLink: `https://calendar.google.com/event?eid=${id}` });
  }

  if (url.startsWith('https://www.googleapis.com/') || url.startsWith('https://openidconnect.googleapis.com/')) {
    record('google_other', url, init);
    return json({ email: 'e2e-calendar@e2e.test' });
  }

  return realFetch(input, init);
};
