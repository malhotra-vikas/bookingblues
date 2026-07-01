# Slack setup for BookingBlues HITL (Slice 7.5 · ADR 0010)

One-time install into the **BookingBlues internal workspace**. Per ADR 0010,
the model is "BB owns the HITL workspace" — operators don't connect their own
Slack. All operators' escalations land in one channel; the BB ops team
triages, replies in-thread to bridge back to SMS via Twilio, or closes via
`/bb` slash commands.

---

## 1. Create the Slack app from the manifest

1. Go to https://api.slack.com/apps → "Create New App" → "From an app manifest".
2. Pick the **BookingBlues** workspace.
3. Paste the contents of `docs/slack-app-manifest.yaml`.
   - **Before pasting, swap every `bookingbluesapi-production.up.railway.app`
     with your real API URL** (Railway public URL today, custom domain after
     Slice 13.5 cutover). For local dev, use your ngrok URL.
4. Click "Next" → "Create".

Slack creates the app with our scopes, the `/bb` slash command, event
subscriptions, and interactivity URLs pre-filled.

---

## 2. Install into the BB workspace + capture the bot token

1. In the app dashboard → "OAuth & Permissions" → "Install to Workspace".
2. Approve the scopes. Slack returns to the dashboard with a **Bot User OAuth
   Token** (`xoxb-...`) — copy it.
3. Find the channel ID for `#hitl` (or whatever BB-internal channel you want
   escalations posting into):
   - In Slack, right-click the channel → View channel details → at the
     bottom you'll see the channel ID (e.g. `C0123ABCDEF`).
4. From "Basic Information", copy the **Signing Secret**.

Set these in Railway (api service) and in your local `.env.local`:

| Field             | Env var                    |
|-------------------|----------------------------|
| Bot User OAuth    | `SLACK_BOT_TOKEN`          |
| `#hitl` channel   | `SLACK_DEFAULT_CHANNEL_ID` |
| `#convos` channel | `SLACK_CONVOS_CHANNEL_ID`  |
| Signing Secret    | `SLACK_SIGNING_SECRET`     |

Create both channels in the BB workspace: `#hitl` (escalation alarms +
buttons) and `#convos` (one thread per conversation — the team's live
view of every AI⟷caller exchange). `#convos` will be the noisier channel;
expect 1 thread per missed call.

Without these the Slack module logs a warning, the escalation falls through
to the email fallback path (Slice 10), and the conversation still flips to
`escalated` so the AI stops replying.

---

## 3. Invite the bot to BOTH channels

In the BB Slack workspace, in each channel:

```
/invite @KeeprSteady
```

Run in `#hitl` AND `#convos`. Without this, `chat.postMessage` returns
`not_in_channel` and the monitoring thread / escalation alarm silently
fall through to the email fallback.

---

## 4. Local dev — ngrok URLs

For local testing, the URLs in the manifest need to point at your tunnel:

```
ngrok http 3001
# pick the https://abc123.ngrok.app URL
```

Then in the Slack dashboard:
- "Event Subscriptions" → Request URL → `https://abc123.ngrok.app/webhooks/slack/events`
- "Interactivity & Shortcuts" → Request URL → `https://abc123.ngrok.app/webhooks/slack/interactivity`
- "Slash Commands" → `/bb` → Request URL → `https://abc123.ngrok.app/webhooks/slack/commands`

Slack will hit your tunnel for URL verification (`url_verification` event)
the moment you save Event Subscriptions; our handler responds with the
challenge without calling any business logic, so verification should succeed
immediately as long as `SLACK_SIGNING_SECRET` is set in `.env.local` and the
API is running.

---

## 5. Smoke-test the bridge

1. Trigger an escalation manually:
   - Easiest: in admin dashboard → operator → conversation → "Force escalate"
     (Slice 15 button) — opens a thread in `#hitl`.
   - Or: a real caller asks for a human via SMS — the bot calls
     `escalate_to_human(reason='caller_requested')`, which posts to `#hitl`.
2. In the Slack thread:
   - Reply with `Hi, calling you back at 4pm` — bridge sends as SMS to the
     caller within ~1 second (capped at one SMS per 8s per conversation, per
     CLAUDE.md §9.3).
   - Run `/bb show-number` — reveals the caller's full E.164 (audit-logged).
   - Run `/bb back-to-bot` — closes the escalation. The next caller SMS
     resumes the AI advance loop with full transcript history.

Slash commands must be run **inside the escalation thread** — the routing
joins on `(channel_id, thread_ts)` to find the right escalation.

---

## 6. Things that will go wrong (and how to recover)

- **`url_verification` fails** — signing-secret mismatch. Update env,
  restart API, click "Retry" in Slack dashboard.
- **`chat.postMessage` returns `not_in_channel`** — the bot is not in the
  channel `SLACK_DEFAULT_CHANNEL_ID` points to. Run `/invite @KeeprSteady`
  in that channel.
- **Escalation posts but in-thread replies don't bridge to SMS** — confirm
  "Event Subscriptions" → "Subscribe to bot events" includes
  `message.channels` (or `message.groups` if `#hitl` is private), AND the
  bot has the matching `channels:history` / `groups:history` scope.
- **`/bb` says "No open escalation for this thread"** — the command was run
  in the channel root, not inside a thread. Open the parent message →
  threaded reply box → re-run.
- **Slack token revoked or invalid** — `SlackApiClient` will surface the
  error; rotate `SLACK_BOT_TOKEN` in env and redeploy.

---

## 7. What's NOT in the manifest

Considered for MVP but pushed out:

- App Home tab — not needed yet.
- Shortcut messages — `/bb` slash command covers the same surface.
- Workflow steps — over-scoped for now.
- Modal-based booking UI for `/bb book` — placeholder text command for now;
  Slice 9-followup wires the real flow.
- Per-trade-category routing (`#hitl-plumbing`, etc.) — single channel for
  MVP volumes (ADR 0010).
