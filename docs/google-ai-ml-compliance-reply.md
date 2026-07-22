# Google OAuth verification — AI/ML Limited Use reply (2026-07-17)

Google's Third-Party Data Safety Team asked us to confirm AI/ML Limited Use
compliance during sensitive-scope verification (scopes `calendar.events`,
`calendar.freebusy`, `userinfo.email`). Their three asks and our position:

1. **Transfer of user data to third-party AI services** — our strongest fact:
   **no Google user data of any kind is ever sent to our AI provider.** The AI
   never reads the Google Calendar. Availability is computed solely from our own
   `appointments` table + the operator's configured business hours
   (`apps/api/src/modules/ai/tool-handlers.ts` `checkAvailability`, and the
   `check_availability` tool never calls Google freeBusy). Event details we write
   *to* Google (via `calendar.events`) originate from the caller's SMS + operator
   config and are never returned to the model.
2. **List of third-party AI integrations + tiers** — OpenAI only, standard API
   (usage-based / pay-as-you-go), Chat Completions API, models `gpt-4.1` and
   `gpt-4.1-mini`. Under OpenAI's API data-usage policy, API-submitted data is not
   used to train OpenAI's models.
3. **Self-hosted/offline model disclosure** — N/A; we use OpenAI's hosted API, and
   since no Google data reaches it, the self-hosted carve-out doesn't apply.

**Privacy policy updated** (`apps/web/app/(marketing)/privacy/page.tsx`, deploy
before replying): added OpenAI to the Section 5 sub-processor list, named OpenAI
as the AI boundary in the Section 4a AI/ML clause ("no Google Calendar data … is
ever sent to our third-party AI provider (OpenAI)"), and added the `userinfo.email`
scope to the Section 4a scope list (it was requested in code but omitted from the
policy).

---

## Email reply (paste into the reply to the Third-Party Data Safety Team)

Subject: Re: [your verification thread subject]

Hello,

Thank you for the review and the clear guidance. We have confirmed our
application's compliance with the Limited Use requirements and completed the
requested actions. Details below.

**1. Transfer of Google user data to third-party AI services — none occurs.**

Our application (KeeprSteady, operated by Malhotra Consultants LLC) does not
transfer any Google Workspace user data — raw, aggregated, or derived — to any
third-party AI/ML service. Specifically:

- The only third-party AI service we use is OpenAI, which powers an SMS
  conversation assistant that helps a homeowner schedule a service appointment
  with the contractor they just called.
- The AI assistant is **never given any Google Calendar data**. It does not
  receive event details (titles, attendees, descriptions, locations) and it does
  not receive Google free/busy times. The appointment availability the assistant
  proposes is computed entirely from (a) our own internal record of appointments
  already booked through our platform and (b) the business hours the contractor
  configured in our app. Google Calendar is used only to *write* the final
  confirmed appointment (via the `calendar.events` scope) — data which flows from
  our system to Google, never from Google to the AI.
- We request the `calendar.freebusy` scope (free/busy only, never event content),
  `calendar.events` (to create the confirmed appointment), and `userinfo.email`
  (to label the connected account). We request no Gmail, Drive, Photos, or other
  Workspace scopes.

Because no Google user data ever reaches OpenAI, there is no pathway by which
Google user data could be used to train or improve any AI/ML model.

**2. List of third-party AI integrations and plan/tier.**

- **Provider:** OpenAI
- **Product/tier:** OpenAI API (standard usage-based / pay-as-you-go API plan),
  Chat Completions API, models `gpt-4.1` and `gpt-4.1-mini`.
- **Data sent to OpenAI:** the End User's SMS message content and the
  contractor's business configuration (business name, trade category, timezone,
  business hours). **No Google user data is included.**
- Per OpenAI's API data-usage policy, data submitted via the API is not used to
  train or improve OpenAI's models.

**3. Self-hosted / offline models.**

Not applicable. We use OpenAI's standard hosted API rather than a self-hosted or
offline model. As described above, no Google user data is transmitted to it.

**Privacy policy disclosure.**

We have updated our privacy policy at https://keeprsteady.com/privacy to reflect
the above. The "Google User Data — Limited Use" section now explicitly states that
no Google Calendar data (neither event details nor free/busy times) is ever sent
to our third-party AI provider (OpenAI), and OpenAI is now listed in our
sub-processor list with a description of exactly what data it receives (SMS content
and business configuration only) and confirmation that Google user data is never
shared with it.

Please let us know if any further information or a new demonstration video would
be helpful.

Best regards,
[Your name]
Malhotra Consultants LLC / KeeprSteady
