/**
 * Verify the missed-calls questionnaire (missedcalls.keeprsteady.com) on a live
 * deployment. No dependencies, no DB access — everything here is an HTTP check.
 *
 *   node scripts/verify-survey.mjs                 # routing + validation only (sends NO email)
 *   node scripts/verify-survey.mjs --submit        # also POSTs one real response (SENDS AN EMAIL)
 *
 * Env overrides (default to prod):
 *   API_BASE=https://api.keeprsteady.com
 *   WEB_BASE=https://keeprsteady.com
 *   SURVEY_BASE=https://missedcalls.keeprsteady.com
 *
 * Run the default form any time. Run --submit once after DNS is live, then
 * confirm the email landed in SURVEY_INBOX_EMAIL.
 */
const API = (process.env.API_BASE || 'https://api.keeprsteady.com').replace(/\/$/, '');
const WEB = (process.env.WEB_BASE || 'https://keeprsteady.com').replace(/\/$/, '');
const SURVEY = (process.env.SURVEY_BASE || 'https://missedcalls.keeprsteady.com').replace(/\/$/, '');
const doSubmit = process.argv.includes('--submit');

let failures = 0;
const pass = (m) => console.log(`  \x1b[32mPASS\x1b[0m ${m}`);
const fail = (m) => {
  failures++;
  console.log(`  \x1b[31mFAIL\x1b[0m ${m}`);
};
const warn = (m) => console.log(`  \x1b[33mWARN\x1b[0m ${m}`);
const info = (m) => console.log(`  ·    ${m}`);

/** fetch that never throws — network/DNS errors come back as a sentinel. */
async function probe(url, init = {}) {
  try {
    const res = await fetch(url, { redirect: 'manual', ...init });
    return { ok: true, status: res.status, headers: res.headers, res };
  } catch (err) {
    return { ok: false, error: err.cause?.code || err.message };
  }
}

console.log('\n=== 1. API endpoint is deployed ===');
{
  // Empty body must come back 400 with per-question issues. A 404 means the
  // build predates the surveys module; 502/503 means the API is still booting.
  const r = await probe(`${API}/v1/surveys/missed-calls`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!r.ok) fail(`cannot reach ${API} — ${r.error}`);
  else if (r.status === 404) fail('404 — this deploy does not include the surveys module yet');
  else if (r.status === 400) {
    const body = await r.res.json().catch(() => ({}));
    const missing = (body.issues || []).map((i) => i.path?.[0]).filter(Boolean);
    if (missing.length >= 6) pass(`deployed — rejects an empty body, requires ${missing.join(', ')}`);
    else fail(`400 but unexpected issues: ${JSON.stringify(body).slice(0, 200)}`);
  } else fail(`unexpected status ${r.status}`);
}

console.log('\n=== 2. Schema rejects bad input ===');
{
  const base = {
    q1: { code: 'A', label: '1–3' },
    q2: { code: 'A', label: 'They call a competitor' },
    q3: [{ code: 'A', label: 'Lead qualifying questions' }],
    q4: { code: 'A', label: 'Housecall Pro' },
    q5: { code: 'A', label: 'Has to integrate' },
    q6: { code: 'A', label: '$0–$99' },
  };
  const cases = [
    ['letter outside the question’s range (q5 has no G)', { ...base, q5: { code: 'G', label: 'x' } }],
    ['more than 3 picks on q3', { ...base, q3: ['A', 'B', 'C', 'D'].map((c) => ({ code: c, label: c })) }],
    ['unknown field (strict schema)', { ...base, q7: { code: 'A', label: 'x' } }],
  ];
  for (const [name, body] of cases) {
    const r = await probe(`${API}/v1/surveys/missed-calls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) fail(`${name} — network error ${r.error}`);
    else if (r.status === 400) pass(`rejects ${name}`);
    else fail(`${name} — expected 400, got ${r.status} (a 202 means an email was just sent!)`);
  }
}

/** The questionnaire's real home. Asserts the page itself, wherever it's served. */
async function checkPage(label, url) {
  const r = await probe(url);
  if (!r.ok) return { reachable: false, error: r.error };
  if (r.status !== 200) {
    fail(`${label}: expected 200, got ${r.status}`);
    return { reachable: true, served: false };
  }
  pass(`${label}: serves 200`);
  // Cloudflare proxy-with-challenge is the known trap (api + web root both hit it).
  if (r.headers.get('cf-mitigated')) {
    fail(`${label}: cf-mitigated header → Cloudflare is challenging this host. Grey-cloud it or add a WAF skip.`);
  }
  const html = await r.res.text();
  for (const [name, needle] of [
    ['headline', 'missed calls'],
    ['question 1', 'voicemail or no answer'],
    ['top-3 question', 'Pick your top 3'],
    ['q4 option', 'Housecall Pro'],
    ['q6 option', 'rather pay per booking'],
    ['noindex', 'noindex'],
  ]) {
    if (html.includes(needle)) pass(`${label}: contains ${name}`);
    else fail(`${label}: missing ${name} ("${needle}")`);
  }
  const radios = (html.match(/type="radio"/g) || []).length;
  const boxes = (html.match(/type="checkbox"/g) || []).length;
  if (radios === 25 && boxes === 7) pass(`${label}: all options render (${radios} radios + ${boxes} checkboxes)`);
  else fail(`${label}: expected 25 radios + 7 checkboxes, got ${radios} + ${boxes}`);
  return { reachable: true, served: true };
}

console.log('\n=== 3. The questionnaire itself (apex — its real home) ===');
await checkPage(`${WEB}/survey`, `${WEB}/survey`);

console.log('\n=== 4. Vanity subdomain (OPTIONAL) ===');
{
  const r = await probe(`${SURVEY}/`);
  if (!r.ok) {
    warn(`${SURVEY} not set up — ${r.error}`);
    info('This is optional. keeprsteady.com/survey is the real link and works without it.');
    info('To enable it, see docs/SURVEY_SUBDOMAIN.md "Vanity subdomain".');
  } else if (r.status === 301 || r.status === 302 || r.status === 307 || r.status === 308) {
    const loc = r.headers.get('location') || '';
    // Cloudflare Redirect Rule path: the subdomain never reaches Railway.
    if (loc.replace(/\/$/, '') === `${WEB}/survey`) pass(`redirects to ${loc}`);
    else if (loc.startsWith(SURVEY)) {
      fail(`REDIRECT LOOP: ${SURVEY} points back at itself (${loc}) — fix the Cloudflare rule.`);
    } else fail(`redirects to unexpected target: ${loc}`);
  } else if (r.status === 200) {
    // Railway custom-domain path: middleware rewrites the root to /survey.
    await checkPage(SURVEY, `${SURVEY}/`);
  } else if (r.status === 404) {
    fail(`404 — DNS resolves but Railway does not know this host. Add it as a custom domain, or use a Cloudflare Redirect Rule instead.`);
  } else fail(`unexpected status ${r.status}`);
}

console.log('\n=== 6. Real submission ===');
if (!doSubmit) {
  info('skipped — re-run with --submit to POST a real response (this SENDS AN EMAIL).');
} else {
  const stamp = new Date().toISOString();
  const body = {
    q1: { code: 'C', label: '8–15' },
    q2: { code: 'A', label: 'They call a competitor' },
    q3: [
      { code: 'A', label: 'Lead qualifying questions (budget, job type, timeline)' },
      { code: 'C', label: 'Automatic calendar booking' },
      { code: 'D', label: 'Deposit collection upfront' },
    ],
    q4: { code: 'B', label: 'Jobber' },
    q5: { code: 'B', label: "I'd switch calendars if the tool solved my problem" },
    q6: { code: 'C', label: '$200–$349' },
    full_name: 'Survey Smoke Test',
    business_name: 'DELETE ME — automated test',
    comments: `Automated verification run at ${stamp}. Safe to delete.`,
    source: 'verify-survey-script',
  };
  const r = await probe(`${API}/v1/surveys/missed-calls`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) fail(`network error ${r.error}`);
  else if (r.status === 202) {
    pass('202 accepted — email dispatched via Resend');
    info('Now check SURVEY_INBOX_EMAIL for: "Missed-calls survey — DELETE ME — automated test"');
    info('Confirm EVERY configured recipient received it (that verifies the comma-separated list).');
  } else {
    const t = await r.res.text().catch(() => '');
    fail(`expected 202, got ${r.status} — ${t.slice(0, 300)}`);
    if (r.status === 400 && t.includes('temporarily unavailable')) {
      info('That message means RESEND_API_KEY / EMAIL_FROM is missing on the api service.');
    }
    if (r.status === 429) info('Throttled (5/min/IP) — wait a minute and retry.');
  }
}

console.log(`\n${failures === 0 ? '\x1b[32mAll checks passed\x1b[0m' : `\x1b[31m${failures} check(s) failed\x1b[0m`}\n`);
process.exit(failures === 0 ? 0 : 1);
