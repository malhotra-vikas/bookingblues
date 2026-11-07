# Spike: live AI voice calls (OpenAI Realtime over Twilio Media Streams)

Branch: `spike/voice-ai-realtime`. Throwaway. The goal is to hear how natural a
live AI phone conversation feels and to measure latency on real calls before
committing to the stack. Nothing here is production-hardened.

## What a call does

1. A missed call hits `/webhooks/twilio/voice/:operatorId` as today.
2. If the operator is listed in `VOICE_AI_OPERATOR_IDS`, is in good standing,
   is under the plan limit, and no human owns the conversation, we answer with
   `<Connect><Stream>` instead of the press-1 IVR. Otherwise the existing IVR to
   SMS flow runs, unchanged.
3. While Twilio connects the stream, the API (in parallel):
   - opens the OpenAI Realtime socket and configures the session,
   - builds the same system prompt the SMS bot uses (operator, category,
     caller history), plus voice rules,
   - pulls any texts already in this conversation,
   - snapshots the next 7 days of calendar availability,
   - opens the `#convos` Slack thread.
4. The bot greets the caller: "Thanks for calling {business}. You're speaking
   with an AI assistant, and this call is recorded. How can I help you today?"
   Caller audio isn't forwarded to the model until that has finished playing, so
   the disclosures can't be talked over. Dual-channel recording starts right
   after.
5. The conversation runs on the same booking tools as SMS (same zod-validated
   dispatcher in `AdvanceService`). Voice-only tools: `record_sms_consent`
   (caller agreed to texts, stored as `sms_consents.source = 'voice_ai_verbal'`)
   and `end_call`.
6. Both sides of the transcript are saved to `messages` (caller/bot) and echoed
   into `#convos`. Payment links go out by text. Escalation tells the caller
   someone will call them back, posts to `#hitl`, and hangs up.
7. If OpenAI fails (can't connect, or drops mid-call), the call is redirected
   to the old press-1 IVR to SMS flow and `#convos` gets an alert.

Code: `apps/api/src/modules/voice/` (bridge, call service, WebSocket gateway,
prompt, tools), wired in `webhooks/twilio-voice.controller.ts`.

## Setup

Env vars (API service):

| Var | Default | Notes |
|---|---|---|
| `VOICE_AI_OPERATOR_IDS` | unset (off) | Comma-separated operator ids, or `*`. |
| `OPENAI_REALTIME_MODEL` | `gpt-realtime` | |
| `OPENAI_REALTIME_VOICE` | `marin` | `cedar` is the other recommended voice. |
| `OPENAI_REALTIME_TRANSCRIBE_MODEL` | `gpt-4o-mini-transcribe` | Transcript only; doesn't affect latency. |
| `VOICE_TURN_DETECTION` | `semantic_vad` | or `server_vad`. Biggest latency knob. |
| `VOICE_VAD_EAGERNESS` | `auto` | semantic_vad only. `high` answers sooner but cuts people off more. |
| `VOICE_VAD_SILENCE_MS` | `500` | server_vad only. Silence before the bot answers. |
| `VOICE_MAX_CALL_SECONDS` | `600` | Then escalate + "someone will call you back". |
| `VOICE_RECORD_CALLS` | `true` | Dual-channel Twilio recording. |

Requirements:
- `OPENAI_API_KEY` and `TWILIO_AUTH_TOKEN` set (the token also signs the stream).
- `API_URL` must be the public `https://` URL. The stream URL is the same host
  over `wss://`. Railway supports WebSockets on the same port.
- **Run one API replica.** Prepared calls live in memory, and the stream must
  land on the process that answered the webhook.
- No Twilio console changes: the number's voice webhook stays the same.
- No migration.

## Test script

Call the test operator's Twilio number from a phone that isn't in a live
conversation with them. Try each of these:

- Plain booking: describe a job, pick a time, agree to texts. You should get the
  confirmation SMS.
- Interrupt the bot mid-sentence. It should stop talking right away.
- Long pause / "umm" mid-sentence. Does it jump in too early?
- Ask for a person. It should say someone will call back, then hang up. `#hitl`
  gets the alarm.
- Out-of-scope request (ask a plumber about a roof).
- Text the number first, then call. The bot shouldn't re-ask what you texted.
- Booking with a deposit (operator with booking fee on): link arrives by text.
- Noisy environment / speakerphone / car.

## What to look at

API logs (structured, no caller audio or transcript text):
- `voice call prepared` with `prepareMs`: time to get ready while Twilio connects.
- `voice turn latency` with `latencyMs` per turn: from OpenAI detecting the
  caller stopped talking to the first bot audio reaching our server. Add roughly
  100 to 200ms for the phone network legs on top.
- `voice call ended` with `latency.p50 / p90 / max`, `durationSec`,
  `callerTurns`, `endedBy`.

Also: the conversation's transcript in the admin/dashboard views, the
`#convos` thread, and the recording in the Twilio console (its SID is in the
transcript as a system message).

Rough bar: p50 under 800ms and p90 under 1.2s feels natural. Above about 1.5s
callers start talking over the bot.

## Known gaps (fine for the spike, fix before shipping)

- Runs inside the API process. A deploy drops live calls. Production needs its
  own Railway service that drains on deploy.
- Single replica only (in-memory prepared calls).
- No `conversations.channel` / `call_sid` columns yet. Voice turns are marked by
  `[Voice call ...]` system messages.
- Recording audio stays in Twilio. Nothing in our DB or dashboard plays it.
- The greeting is spoken by the model, told to say the disclosure word for word.
  Check the saved transcript of the first bot turn. If it ever paraphrases, swap
  to a fixed `<Say>` before `<Connect>` (costs a second voice and some latency).
- The booking confirmation SMS goes out from `BookingsService` whether or not
  the caller agreed to texts on the call. The prompt asks first, but nothing
  enforces it yet.
- `#convos` gets one Slack message per turn. Fine for testing, too chatty for
  production.
- Live transfer to the operator is deliberately not built (forwarding loop:
  an unanswered operator phone forwards back to us).
- The A2P campaign describes the press-1 IVR as the consent method. A
  production rollout needs that registration updated for verbal consent on the
  AI call.
- Latency was not measured anywhere real yet. Everything above is what to
  measure.
