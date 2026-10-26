# Missed-calls questionnaire — `missedcalls.keeprsteady.com`

Six-question research survey linked from the outbound lead email. Responses are
**emailed** to `SURVEY_INBOX_EMAIL` (one or more addresses) via Resend — there is
no database table and no Slack post (deliberate: this is a one-off campaign, not
an ongoing funnel).

## Where it lives

**The questionnaire's real home is `https://keeprsteady.com/survey`.** It is a
page in the existing `web` app — no new Railway service, no DNS required. It
works the moment the app deploys.

The `missedcalls.` subdomain is an **optional vanity alias**. It is not required
and nothing depends on it.

> **Why the subdomain isn't the primary URL.** Railway must register a custom
> domain before it can terminate TLS for that hostname. So a Cloudflare DNS
> record alone can't serve it: grey-clouded you get a TLS error (Railway has no
> cert for a domain it doesn't know), and orange-clouded Cloudflare's cert works
> but Railway answers "Application not found" because the `Host` header names a
> hostname it isn't configured for. Cloudflare cannot substitute for the Railway
> side of that.

| Request | Result |
|---|---|
| `keeprsteady.com/survey` | **serves the questionnaire** ← use this link |
| `missedcalls.keeprsteady.com/` | only if you set up the alias below |
| `missedcalls.keeprsteady.com/<other path>` | 308 → `keeprsteady.com/<same path>` (Railway route only) |

The subdomain host is matched on its **leading label** (`missedcalls.`), so
Railway preview domains and a local `missedcalls.localhost:3000` work without
config.

⚠️ **Never add an apex → subdomain redirect** while the Cloudflare redirect rule
below exists — the two bounce off each other in an infinite loop. There's a
comment in `middleware.ts` saying so.

## Vanity subdomain (optional — two ways)

**Option A — Cloudflare Redirect Rule. No Railway involvement.** The request is
answered at Cloudflare's edge and never reaches the origin, so Railway never
needs to know the hostname.

1. DNS → add `missedcalls`, **proxied (orange cloud)**. Target doesn't matter
   since nothing is forwarded — `AAAA 100::` (Cloudflare's documented
   redirect-only sink) is the conventional choice. Proxied is **required** here:
   the redirect rule and Universal SSL only apply to proxied records.
2. Rules → Redirect Rules → Create:
   - When: `Hostname` equals `missedcalls.keeprsteady.com`
   - Then: Static redirect → `https://keeprsteady.com/survey`, status **301**
3. Universal SSL already covers one level of subdomain, so TLS just works.

**Option B — Railway custom domain.** If Railway will accept it (custom-domain
count is plan-limited, which is the usual reason it refuses), add
`missedcalls.keeprsteady.com` on the `web` service, then add the Cloudflare
`CNAME` it gives you as **DNS-only (grey cloud)** — a proxied record with a
challenge enabled returns `403 cf-mitigated: challenge` to non-JS clients, which
is what already bit `api.keeprsteady.com` and the web root. Middleware then
rewrites the subdomain's root to `/survey`.

Either option is verified by `node apps/api/scripts/verify-survey.mjs`, which
detects which one you used and flags a redirect loop if both got configured.

The page is `noindex, nofollow` — it's a campaign form, not a marketing page.

Files:
- `apps/web/app/survey/page.tsx` — page shell, metadata, query-param prefill
- `apps/web/app/survey/layout.tsx` — standalone chrome (the marketing layout's
  root-relative nav links would break on this host)
- `apps/web/components/survey/MissedCallsSurvey.tsx` — **the questionnaire
  wording lives here**
- `apps/api/src/modules/surveys/surveys.controller.ts` — `POST /v1/surveys/missed-calls`

## Go-live checklist

1. **Nothing to do for the page itself** — `keeprsteady.com/survey` is live on
   deploy. The vanity subdomain above is optional and can come later (or never).

2. **Env** — set on the `api` service if the default isn't wanted. Accepts a
   **comma-separated list** for multiple recipients (all on one `To:` line, so a
   reply reaches the whole list; whitespace around commas is ignored):
   ```
   SURVEY_INBOX_EMAIL=sales@keeprsteady.com                          # default
   SURVEY_INBOX_EMAIL=sales@keeprsteady.com,vikas@keeprsteady.com    # multiple
   ```
   Every address is validated at boot — one malformed entry and the API refuses
   to start (CLAUDE.md §7), so check the deploy logs after changing it.

   Requires `RESEND_API_KEY` + `EMAIL_FROM` already set (they are, for careers).

3. **Smoke test**:
   ```
   node apps/api/scripts/verify-survey.mjs            # routing + validation, sends NO email
   node apps/api/scripts/verify-survey.mjs --submit   # also POSTs one real response (SENDS EMAIL)
   ```
   `--submit` files a response tagged `DELETE ME — automated test`. Confirm it
   reaches **every** address in `SURVEY_INBOX_EMAIL` — that's what proves the
   comma-separated list parsed correctly in prod.

## Link format for the lead email

Bare link (anonymous is allowed and expected):

```
https://keeprsteady.com/survey
```

Prefilled + attributed — recommended for a known lead, since it removes typing
and tags the response to the campaign:

```
https://keeprsteady.com/survey?email={{email}}&name={{first_name}}&business={{business}}&src=lead-email-2026-07
```

If you set up the vanity subdomain, `https://missedcalls.keeprsteady.com/` works
too and carries the same query params through the redirect — but the apex link
above works today and needs no DNS.

| Param | Prefills | Cap |
|---|---|---|
| `email` | Email field | 160 chars |
| `name` | Your name field | 120 |
| `business` | Business name field | 160 |
| `src` | (hidden) reported as **Source** in the email | 60 |

URL-encode the values. All are optional; the respondent can edit or clear any of
them, and can submit with all four blank.

## Editing the questions

Reword a question or an option label in `MissedCallsSurvey.tsx` and ship — the
API prints whatever label the respondent actually saw, so the email follows
automatically.

The `A`/`B`/`C` letters are **internal identifiers and are not rendered on the
form** (a radio list already says "pick one"; printing "A)" in front of each
option is on-screen noise). They exist so an answer stays comparable across copy
edits, and they appear in the notification email — `B) 4–7` — so responses stay
easy to tally.

**Adding or removing an option letter also requires** updating `ALLOWED_CODES`
in `surveys.controller.ts` (it validates that, say, a `q5` answer is one of
A–D). The controller comments explain the split: the letter code is the strict
contract, the label is capped, HTML-escaped display text. `surveys.schema.spec.ts`
locks the code space.

## Deliberate non-goals

- **No persistence.** Responses live in the inbox. If we later want aggregate
  charts, add a `survey_responses` table + migration and write alongside the
  email — the controller is the single place to change.
- **No Slack post.** Add one by injecting `SlackApiClient` the way
  `leads.controller.ts` does.
- **No auth, no captcha.** Throttled to 5 POSTs/min/IP; worst case is junk mail
  to one inbox.
