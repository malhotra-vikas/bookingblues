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
  - `https://www.googleapis.com/auth/calendar.readonly` (free/busy availability)
  - `https://www.googleapis.com/auth/calendar.events` (create the booking event)
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
- [x] **Scopes declared** in Data Access (calendar.readonly + calendar.events).
- [ ] **Demo video recorded** (script below).
- [ ] **Submitted for verification** (justifications + video).
- [ ] **Approved** by Google → warning gone for non-test users → blocker cleared.

**Interim:** add the test Google account to OAuth consent screen → **Test users**
(≤100) so calendar connect keeps working during review.

---

## Scope justifications (paste one per scope)

**`https://www.googleapis.com/auth/calendar.readonly`**
> KeeprSteady is an AI assistant that books appointments for home-service businesses
> (plumbers, HVAC, electricians, roofers). When a homeowner texts the business, our
> assistant must offer real open time slots. We use `calendar.readonly` to call the
> Calendar `freebusy.query` API and read the operator's busy/free times so we only
> propose slots when they are actually available. We read availability only — we do
> not display or store the contents of unrelated events. This read access is required
> because we cannot know which times to offer without seeing the operator's existing
> commitments.

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

| Time | Show on screen | Say (narration / caption) |
|---|---|---|
| 0:00 | `keeprsteady.com` homepage (URL bar visible) | "This is KeeprSteady, an AI assistant for home-service businesses. It books missed-call leads and puts the appointment on the operator's Google Calendar." |
| 0:15 | Sign in → onboarding → the **"Connect Google Calendar"** step; click Connect | "During onboarding, the operator connects their Google Calendar." |
| 0:25 | The **Google OAuth consent screen** — pause so the **app name (KeeprSteady), the two scopes, and the project/client** are clearly visible | "KeeprSteady requests two scopes: read-only access to see availability, and calendar events access to create the booking." Then click **Allow**. |
| 0:45 | Back in the app — start an SMS booking (or the demo/test conversation) where the assistant proposes available time slots | "Using calendar.readonly, KeeprSteady reads the operator's free/busy availability and offers only open time slots to the caller." |
| 1:05 | Caller picks a slot → booking confirms | "Using calendar.events, KeeprSteady creates the appointment as an event." |
| 1:20 | Open **Google Calendar** for that operator account → show the newly created event at the booked time | "Here is the event KeeprSteady just created on the operator's Google Calendar — confirming the calendar.events scope." |
| 1:35 | Briefly show `keeprsteady.com/privacy` scrolled to the **"Google User Data — Limited Use"** section | "Our use of Google data follows the Limited Use requirements, described in our privacy policy." |

**Recording tips**
- Keep the **browser URL bar visible** throughout (proves it's the real `keeprsteady.com`).
- On the consent screen, don't rush — reviewers need a clear frame showing the app name + both scopes.
- Use a real Google account you control (a test user is fine) so the consent + event creation are genuine.

## Submit
**Google Auth Platform → Data Access / Verification Center → Submit for verification**
→ paste the justifications, add the YouTube link. Replies go to
`malhotra.vikas@gmail.com`; sensitive-scope review ≈ a few days to ~2 weeks.

## Optional later — narrow the scope
`calendar.readonly` is only used for free/busy. Switching to the narrower
`calendar.freebusy` (one line in `google-oauth.service.ts`) is easier for reviewers
to approve — but must be deployed BEFORE re-declaring scopes so they match. Defer
unless Google pushes back.
