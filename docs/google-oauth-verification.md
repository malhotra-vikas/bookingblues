# Google OAuth Verification — KeeprSteady

Working doc for clearing the **🔴 launch blocker**: the Google OAuth consent screen
must be verified for the sensitive Calendar scopes so real operators (not just
test users) can connect Google Calendar without the "Google hasn't verified this
app" warning.

## Setup / facts (as of 2026-06-26)
- **Google Cloud project:** `bookingblues-staging` (project number **670004772057**) —
  this single project's OAuth client is used by **prod** (`keeprsteady.com`) too.
  (Smell: prod uses a project named `-staging`; fine functionally, ideally split later.)
- **OAuth client ID:** `670004772057-…apps.googleusercontent.com`
- **Redirect URI:** `https://api.keeprsteady.com/webhooks/google/oauth/callback`
  (on an owned domain — good for verification).
- **Scopes requested** (in `apps/api/src/modules/calendar/google-oauth.service.ts`):
  - `https://www.googleapis.com/auth/calendar.freebusy` (free/busy availability —
    narrowed from `calendar.readonly` on 2026-07-07 since freeBusy is all we read)
  - `https://www.googleapis.com/auth/calendar.events` (create the booking event)
  - **Deploy note:** this narrower scope must be **deployed to prod** and the
    consent screen re-declared to it **before** submitting, so the live consent
    screen the reviewer sees matches the submission.
- **Consent screen URLs:** home `https://keeprsteady.com`, privacy
  `https://keeprsteady.com/privacy` (has the "Google User Data — Limited Use"
  section), terms `https://keeprsteady.com/terms`.

## Status
- [x] **Branding verified** ("being shown to users").
- [x] **Homepage reachable to automated clients** — root cause of three earlier
  rejections was a **Cloudflare blanket challenge** (`cf-mitigated: challenge`,
  403) on `keeprsteady.com` that blocked Google's crawler. The web root (not just
  the API) MUST stay un-challenged. Verify with `curl -sI https://keeprsteady.com`
  → must be `HTTP 200`, no `cf-mitigated: challenge`.
- [x] **Scopes declared** in Data Access — ⚠️ **must be updated** to
  `calendar.freebusy` + `calendar.events` (was `calendar.readonly`) before submit,
  and prod must be deployed with the narrower scope first.
- [x] **Demo video recorded** (2026-07-10) — uploaded to YouTube Unlisted, linked
  in the verification form.
- [x] **Submitted for verification** (2026-07-10) — justifications + video sent.
  ⏳ **Awaiting Google review** (typically a few days to ~2 weeks; replies to
  `malhotra.vikas@gmail.com`). Watch that inbox for follow-up questions — a quick
  reply keeps the review moving.
- [ ] **Approved** by Google → warning gone for non-test users → blocker cleared.

**Interim:** add the test Google account to OAuth consent screen → **Test users**
(≤100) so calendar connect keeps working during review.

---

## Scope justifications (paste one per scope)

**`https://www.googleapis.com/auth/calendar.freebusy`**
> KeeprSteady is an AI assistant that books appointments for home-service businesses
> (plumbers, HVAC, electricians, roofers). When a homeowner texts the business, our
> assistant must offer real open time slots. We use `calendar.freebusy` to call the
> Calendar `freebusy.query` API and read only the operator's busy/free times so we
> propose slots only when they are actually available. We never read event details,
> titles, or attendees — only busy/free windows. This is the narrowest scope that
> lets us know which times to offer without seeing the operator's existing commitments.

**`https://www.googleapis.com/auth/calendar.events`**
> When the homeowner confirms a time over SMS, KeeprSteady creates that appointment as
> an event on the operator's primary Google Calendar (with the job summary and, if
> provided, the caller's email as an attendee) so the booking appears on the operator's
> schedule and triggers their normal calendar reminders. We use `calendar.events`
> solely to create and manage the appointments booked through KeeprSteady. A narrower
> scope is not sufficient because we must write a new event to the operator's calendar.

**Overall "how does your app use Google user data" (if asked)**
> Operators connect their Google Calendar during onboarding. KeeprSteady reads their
> free/busy availability to propose open appointment times to callers via SMS, and
> writes the confirmed appointment back to their calendar. Google Calendar data is used
> only to provide this scheduling feature, is never sold or used for advertising, and is
> handled per the Google API Services User Data Policy including the Limited Use
> requirements (stated at https://keeprsteady.com/privacy).

---

## Demo video script

**Reviewer requirements:** English narration or captions; show the live
`keeprsteady.com` app; clearly show the OAuth consent screen with the **same Client
ID/project** under review; demonstrate **each** requested scope being used. ~1.5–2.5
min, screen-recorded, uploaded to **YouTube (Unlisted)**.

**Before recording**
- Confirm prod is deployed with the `calendar.freebusy` scope (so the consent
  screen shows freebusy, not readonly).
- Use a real Google account you control (a Test User is fine) with a fairly empty
  calendar so the created event stands out.
- The real booking needs a long SMS conversation before the calendar event is
  created — too slow for a demo. Use the **"Run test booking"** button
  (Settings → Integrations, added 2026-07-07) which checks free/busy and creates
  a real event in one click, exercising BOTH scopes on camera. See
  `POST /v1/operators/me/calendar/test-event`.

| Time | Show on screen | Say (narration / caption) |
|---|---|---|
| 0:00 | `keeprsteady.com` homepage (URL bar visible) | "This is KeeprSteady, an AI assistant that helps home-service businesses — plumbers, HVAC, electricians, roofers — book the calls they miss and add the appointment to their Google Calendar." |
| 0:15 | Sign in → onboarding → the **"Connect Google Calendar"** step; click Connect | "During onboarding, the business owner connects their Google Calendar." |
| 0:25 | The **Google OAuth consent screen** — pause 3-4s so the **app name (KeeprSteady), the two scopes, and the project/client** are clearly readable | "KeeprSteady requests two permissions: view free/busy availability, and create and manage calendar events." Then click **Allow**. |
| 0:45 | Settings → Integrations → click **"Run test booking"**; it shows the chosen open slot | "Using the free/busy scope, KeeprSteady reads only the operator's busy and free times — never event details — and finds a genuinely open slot." |
| 1:05 | The success message shows the appointment was created (with a link) | "Using the calendar events scope, KeeprSteady creates the appointment on the operator's calendar." |
| 1:20 | Open **Google Calendar** for that operator account → show the newly created event at the booked time (open it to show details) | "Here is the event KeeprSteady just created — this is why we need write access: to place confirmed bookings on the operator's schedule." |
| 1:35 | Briefly show `keeprsteady.com/privacy` scrolled to the **"Google User Data — Limited Use"** section | "Our use of Google data follows Google's Limited Use requirements, described in our privacy policy — used only for scheduling, never sold or used for advertising." |

**Recording tips**
- Keep the **browser URL bar visible** throughout (proves it's the real `keeprsteady.com`).
- On the consent screen, don't rush — reviewers need a clear frame showing the app name + **both scopes** (freebusy + events).
- Use a real Google account you control (a test user is fine) so the consent + event creation are genuine.
- Prefer live narration; if using captions, hold them on screen long enough to read.

**Suggested Unlisted YouTube listing**
- Title: `KeeprSteady — Google Calendar OAuth scope demo`
- Description: "Demonstration of KeeprSteady (keeprsteady.com) using calendar.freebusy (read availability) and calendar.events (create the confirmed appointment). Shows the consent screen, a free/busy availability check, a booking, and the created event. Google Calendar data is used only for scheduling, never sold or used for ads."

## Submit
**Google Auth Platform → Data Access / Verification Center → Submit for verification**
→ paste the justifications, add the YouTube link. Replies go to
`malhotra.vikas@gmail.com`; sensitive-scope review ≈ a few days to ~2 weeks.

## Scope narrowing — DONE (2026-07-07)
Switched `calendar.readonly` → `calendar.freebusy` in `google-oauth.service.ts`
(freeBusy is all we read). Easier for reviewers to approve.
**Order of operations before submitting:**
1. ✅ Code changed (SCOPES in `google-oauth.service.ts`).
2. ⬜ **Deploy the API to prod** so the live consent screen requests `calendar.freebusy`.
3. ⬜ **Re-declare scopes** in the Google Auth Platform → Data Access to
   `calendar.freebusy` + `calendar.events` (remove `calendar.readonly`).
4. ⬜ Record the demo video (consent screen will now show `freebusy`).
5. ⬜ Submit with the updated justifications above.

⚠️ Any operator who connected under the old `calendar.readonly` grant keeps
working (existing refresh tokens are unaffected). New/re-connections get the
narrower scope.
