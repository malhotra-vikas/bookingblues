# Insurance Agencies — caller-facing copy review (started 2026-11-04)

Live test on prod: operator "Insurance Test" (`malhotra.vikas+ins1`), number (413) 216-4678.
Each row: what the caller got today → proposed insurance version. Nothing is changed in code yet;
we collect the whole conversation first, then rewrite in one pass.

Constraints that apply to every rewrite:
- First SMS must keep the opt-out disclosure ("Reply STOP to opt out. Msg & data rates may apply.").
- Voice consent wording is the A2P opt-in language — keep the press 1 / say yes, STOP/HELP and
  rates parts word-for-word in substance; only the framing around them can change.
- Never ask for Medicare number (MBI) or SSN by text.
- Trade copy must stay as-is — insurance gets its own variant (switch via `ai/category-profile.ts`).

## 1. Voice greeting (before the first text)
Source: `apps/api/src/modules/consent/sms-consent.dto.ts` `VOICE_CONSENT_TEXT`
- Today: "Thanks for calling [business]. Sorry we missed you! To get a text right now so we can
  get you scheduled, press 1, or say yes. …"
- Issue: fine, but generic. Could say "set up a time with one of our licensed agents".
- Proposed: "Thanks for calling [business]. Sorry we missed you — our agents are with other
  clients. To get a text right now so we can set up a time with an agent, press 1, or say yes. …"

## 2. Opening SMS
Source: `apps/api/src/modules/conversations/templates/sms-templates.ts` `openingSms()`
- Today: "Hi! Thanks for calling Insurance Test. What can we help with today? Reply here and
  we'll get you on the schedule. Reply STOP to opt out. Msg & data rates may apply."
- Issue: tradesman tone ("get you on the schedule"); doesn't say who/what; no hint of what the
  agency helps with, so callers give one-word answers.
- Proposed: "Hi, this is Insurance Test — sorry we missed your call! Are you looking at a new
  plan, reviewing your current coverage, or have a question? Reply here and we'll set up a time
  with an agent. Reply STOP to opt out. Msg & data rates may apply."

## 3. First AI reply (from the category prompt — `categories.system_prompt_template` for `insurance`)
- Caller: "I need to know more about Insurance"
- Bot: "Thanks for reaching out! Can you tell me a bit more about what type of insurance you'd like
  to discuss, such as Medicare, health, life, or another type?"
- OK: right question. Notes: "Thanks for reaching out" repeats the opener's thanks; it doesn't ask
  the name early (agencies want to know who they're talking to). If the opener asks the type
  (item 2), this turn can move straight to name + what they need.

## 4. Name ask
- Caller: "Medicare" → Bot: "Great, we can help with that. Can I get your first and last name to
  get started?"
- OK. Could add a word of context so the intake feels purposeful, e.g. "…to get started? Our
  agent will use this to prepare for your appointment."

## 5. DOB ask
- Caller: "Vikas M" → Bot: "Thank you, Vikas. Could you please provide your date of birth?"
- Issue: asking DOB by text with no reason given feels like a scam to many seniors. Should say why
  and that it's optional-ish / kept private, e.g. "Thanks, Vikas. What's your date of birth? It
  helps our agent check which Medicare plans you qualify for — we keep it private."
- Also: accepted "Vikas M" as a full name without asking for the last name (fine for SMS; agent
  can confirm on the call).

## 6. Caller pushback on DOB
- Caller: "Why do you need that?" → Bot: "That's a good question, Vikas. Your date of birth helps the
  agent review Medicare options that fit your situation. It's kept private and only used for your
  appointment. Would you feel comfortable sharing it? If not, let me know and we can proceed
  differently."
- Good recovery — this explanation is exactly what item 5 should say up front, so the caller never
  has to ask. Minor: "proceed differently" is vague → "that's fine, the agent can get it on the call."

## 7. Partial DOB accepted + no eligibility awareness  ⚠️ prompt logic, not just copy
- Caller: "Ok I was born in 1977" → Bot: "Thanks, Vikas. Could you tell me the name of your current
  doctor or doctor's office? If you don't have one or prefer not to say, that's fine—just let me know."
- Issues:
  a) Accepted a birth YEAR as the DOB — never asked for month/day. Prompt should ask once for the
     full date (MM/DD/YYYY) and accept a partial answer only if the caller declines.
  b) Caller is ~49 — under 65. Medicare under 65 is only via disability (SSDI 24 mo), ESRD or ALS.
     The bot didn't notice. Should NOT refuse or judge eligibility (agent's job, and compliance-
     sensitive), but a light touch helps the agent: e.g. "Thanks! Since you're under 65, are you
     currently on disability or getting Medicare already? Just so the agent comes prepared." —
     or simply record it in the summary for the agent. Decide which.
- Doctor ask: good — explains it's optional.

## 8. Correction handled
- Caller: "Actually correct that. 1955" → Bot: "Thanks for the update, Vikas. Could you share the name
  of your current doctor…" (re-asks doctor, reworded).
- OK. Nice to have: echo the corrected value ("Got it — 1955.") so the caller knows it stuck.
- TO VERIFY after booking: the appointment's intake answers show DOB 1955, not 1977 (operator view).

## 9. Doctor + prescriptions ask
- Caller: "Dr Uthappa on the main st" → Bot: "Got it, thank you. Last question: Can you list any
  prescriptions you take? If there are none, or if you'd prefer not to share, just let me know."
- Good: "Last question" signposting, optional framing. Could add why ("so the agent can check which
  plans cover your medications") — the #1 reason Medicare shoppers care.

## 10. Prescriptions vague → slots offered
- Caller: "I have a few" → Bot asks for names, offers to note "prefers not to share". Good.
- Caller: "Like for High BP and diabetes" → (reply lost: Twilio account suspended 20:07, balance $0;
  topped up 20:12. Not a copy issue. Ops: enable Twilio auto-recharge.)
- Caller: "Are you there" → Bot: "Thanks, Vikas—I'm here! The agent is available for a Medicare review
  on Thursday, Nov 5, at 9am, 10am, or 11am. Does one of these times work for you?"
- Issues: accepted conditions instead of drug names without a word — fine, but should say "No problem —
  bring your medication bottles or a list to the appointment." Also no in-person vs phone choice;
  agencies often do both — ask "at our office or by phone?" (needs a product decision).
- Log noise: zod rejected `save_intake_answers` with empty `doctor` at 20:05 (model retried OK) —
  prompt should tell the model to omit unknown fields rather than send "".

## 11. Booked ✅ — and a data-accuracy bug  🔴 fix before real clients
- Caller: "I would like to talk to you in Sunday" → Sun Nov 8 9/10/11am offered. "Ok 10 am works" →
  "✅ Vikas, you're booked with Insurance Test for Sun, Nov 8, 10:00 AM. Add to your calendar: <ics>"
- Verified: appointment confirmed 15:00 UTC (= 10:00 ET), Google event created, fee none, usage 1/80
  (in_trial=true, plan solo), dashboard shows it with decrypted intake answers, DOB correction kept.
- 🔴 Operator sees **Date of birth 01/01/1955** — caller only gave the year. The model INVENTED Jan 1
  because `save_intake_answers` (`ai/tool-definitions.ts:235,250`) requires a full `YYYY-MM-DD` and
  makes every field required (same cause as the empty-`doctor` zod reject in item 10). Agent would
  quote/enroll on a wrong DOB. Fix: allow partial DOB (`YYYY` / `YYYY-MM` / `YYYY-MM-DD`), make fields
  optional/nullable with an explicit "declined" option, prompt: never guess — record exactly what
  was said. Same for last name ("Vikas M" → last_name "M") and Rx ("High BP medication, Diabetes
  medication" are conditions, should be shown as said: "for high BP and diabetes").
- Confirmation copy: generic "you're booked with X". Insurance version should say what the meeting is
  and where/how: "✅ Vikas, your Medicare review with Insurance Test is set for Sun, Nov 8, 10:00 AM
  at <office address / by phone>. Bring your Medicare card and a list of your medications."
  (Needs an office address or "phone" setting — today insurance has no address field.)

## 12. Follow-up after booking
- Caller: "What should I bring?" → Bot: "You don't need to bring anything special, Vikas. The agent will
  review your needs … If you have a list of your prescriptions or doctors, that can be helpful, but
  it's not required. See you then!"
- ✅ Double-booking fix holds on prod: answered without re-offering slots.
- Copy: "nothing special" is wrong for Medicare.
- ✅ DONE locally (not deployed): bring-list sent BY DEFAULT in the confirmation + 24h reminder, and the
  bot's prompt carries the same list (+ never ask for MBI/SSN by text). Source:
  `sms-templates.ts` `BRING_LISTS` / `bringListFor()`. List: Medicare card (shows MBI), photo ID,
  current plan card + plan letters (ANOC), medication list/bottles, doctors' + pharmacy names,
  Medicaid / Extra Help letters; plus "please don't text us your Medicare number". Later: make it
  agency-editable.
- Note: conversation status went completed → awaiting_caller on the follow-up (outcome stays booked).
  Check the dashboard still counts it as booked and it doesn't show as "active".
