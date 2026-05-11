# Slack setup for BookingBlues HITL (Slice 7.5)

Step-by-step for the first install. After this is done, each Operator installs
the BookingBlues app into *their own* workspace via the dashboard — they don't
need to go through any of this.

---

## 1. Create the Slack app from the manifest

1. Go to https://api.slack.com/apps → "Create New App" → "From an app manifest".
2. Pick the BookingBlues development workspace (you can change distribution
   later when going to single- vs. multi-workspace).
3. Paste the contents of `docs/slack-app-manifest.yaml`.
   - **Before pasting, swap every `bookingbluesapi-production.up.railway.app`
     with your real API URL** (Railway public URL today, custom domain after
     Slice 13.5 cutover). For local dev, use your ngrok URL.
4. Click "Next" → "Create".

Slack creates the app with our scopes, the `/bb` slash command, event
subscriptions, interactivity, and the OAuth redirect URL pre-filled.

---

## 2. Grab the three credentials

From the new app's "Basic Information" page:

| Field           | Goes into env var       |
|-----------------|-------------------------|
| Client ID       | `SLACK_CLIENT_ID`       |
| Client Secret   | `SLACK_CLIENT_SECRET`   |
| Signing Secret  | `SLACK_SIGNING_SECRET`  |

Set these in Railway (api service) and in your local `.env.local`. The Slack
module refuses to serve the install / webhook routes without all three.

The `SLACK_SIGNING_SECRET` is what `SlackSignatureGuard` validates against —
this is the single-secret HMAC that protects every inbound Slack webhook.

---

## 3. Distribution (single vs. multi-workspace)

For MVP, we **distribute privately** — each Operator's workspace install is
gated to whoever you share the install URL with.

1. "Manage Distribution" → leave "Public Distribution" *off*.
2. (Later) When opening to multiple workspaces of unrelated operators, enable
   "Public Distribution" and go through Slack's submission process. Not
   required for MVP since each Operator is invited explicitly.

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
- "OAuth & Permissions" → Redirect URLs → `https://abc123.ngrok.app/webhooks/slack/oauth/callback`

Slack will hit your tunnel for URL verification (`url_verification` event) the
moment you save Event Subscriptions; our handler responds with the challenge
without calling any business logic, so verification should succeed immediately
as long as `SLACK_SIGNING_SECRET` is set in `.env.local` and the API is running.

---

## 5. Operator-side install (per workspace)

Every Operator using HITL:

1. Sign in to BookingBlues → Settings → "Connect Slack".
2. The dashboard calls `GET /v1/operators/me/slack/install` which returns a
   signed Slack OAuth URL.
3. Operator follows the link → grants permissions → Slack redirects to
   `/webhooks/slack/oauth/callback` which writes an encrypted bot token to
   `slack_connections` (AES-256-GCM with versioned key, per CLAUDE.md §11.4).
4. Operator picks the channel the bot should post escalations into.

---

## 6. Smoke-test the bridge

After at least one Operator install:

1. Trigger an escalation manually:
   - Easiest: in admin dashboard → operator → conversation → "Force escalate"
     (Slice 15 button) — opens a Slack thread.
   - Or: a real caller asks for a human via SMS — the bot calls
     `escalate_to_human(reason='caller_requested')`, which posts to Slack.
2. In the Slack thread:
   - Reply with `Hi, calling you back at 4pm` — bridge sends as SMS to the
     caller within ~1 second (capped at one SMS per 8s per conversation, per
     CLAUDE.md §9.3).
   - Run `/bb show-number` — reveals the caller's full E.164 (audit-logged).
   - Run `/bb back-to-bot` — closes the escalation. The next caller SMS
     resumes the AI advance loop with full transcript history.

---

## 7. Things that will go wrong (and how to recover)

- **"url_verification fails"** — signing secret mismatch. Update env, restart
  API, click "Retry" in Slack dashboard.
- **"OAuth state signature bad"** — our state HMAC uses `SLACK_SIGNING_SECRET`.
  Don't rotate it between an Operator clicking Install and finishing the OAuth
  redirect (otherwise the state won't verify).
- **"chat.postMessage returns not_in_channel"** — the bot needs to be invited
  to the target channel. The default-channel install flow does this; manual
  channel picks need `/invite @BookingBlues` once.
- **Escalation posts but no thread replies bridge to SMS** — confirm the bot
  has `channels:history` (public) or `groups:history` (private) on the channel
  type, AND that "Event Subscriptions" → "Subscribe to bot events" includes
  `message.channels` / `message.groups`.
- **Slack token revoked** — `slack_connections.status` flips to `revoked` and
  the EscalationsService falls back to the email path (Slice 10 — once Resend
  is wired). Operator re-installs via the dashboard.

---

## 8. What's NOT in the manifest

These were considered for MVP but pushed out:

- App Home tab — not needed yet; operators rarely visit it.
- Shortcut messages — `/bb` slash command covers the same surface.
- Workflow steps — over-scoped for now.
- Modal-based booking UI for `/bb book` — placeholder text command for now;
  Slice 9-followup wires the real flow.
