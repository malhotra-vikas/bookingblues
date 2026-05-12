# ADR 0010 — HITL via a single BookingBlues-team Slack workspace

**Status**: accepted (2026-05-12). Supersedes the per-operator Slack model
shipped under Slice 7.5 (commits `b955847`, `4619da0`).

## Context

Slice 7.5 (2026-05-11) wired the HITL escalation path through Slack: when the
AI couldn't handle a caller, an `escalate_to_human` tool call would post into
**the operator's** Slack workspace. The operator (or someone on their team)
would respond in-thread; replies bridged back to SMS via Twilio.

This assumed each operator either runs a Slack workspace or could easily
install ours. In practice:

- The MVP audience is solo trades — plumbers, roofers, HVAC, electricians,
  garage door, locksmiths. They live in SMS. Most do not run Slack.
- Even operators with a Slack workspace are unlikely to staff it 24/7 for
  HITL response — escalations would just queue.
- The humans actually closing the HITL loop in MVP are the **BookingBlues
  internal team**: that's where the ops capacity lives, and the value prop
  ("we book your missed calls") implies BB owning the recovery path.

The per-operator OAuth install added significant surface area for what is, at
MVP scale, a wrong-end-of-the-stick architecture:

- Per-operator OAuth dance (state HMAC, callback, encrypted token storage).
- `/v1/operators/me/slack/install` endpoint + future "Connect Slack" button.
- Per-channel routing logic in webhook handlers
  (`SlackConnectionsService.findByChannelId / findByTeamId`).
- A `slack_connections` table holding one row per operator with an encrypted
  bot token.
- Operator-facing setup docs explaining "invite the bot, pick a channel".

## Decision

Adopt a single shared Slack workspace owned by BookingBlues. The HITL bot is
installed once into that workspace; the bot token and the channel ID live in
env vars. All operators' escalations post into one `#hitl` channel, with the
operator's business name + caller last-4 + reason in the post header so
triage staff can route mentally.

### Implementation summary

| Component | Before (per-operator) | After (platform) |
|---|---|---|
| Bot token | encrypted column on `slack_connections` | `SLACK_BOT_TOKEN` env var |
| Channel | `slack_connections.default_channel_id` | `SLACK_DEFAULT_CHANNEL_ID` env var |
| Install flow | OAuth via `/v1/operators/me/slack/install` + state HMAC | None — BB ops installs the app once |
| `slack_connections` table | per-operator install rows | dropped (migration `20260512000002`) |
| Webhook routing | `(team_id, channel_id) → operator` | `(channel_id, thread_ts) → escalation → conversation → operator` |
| Slash commands | invoked anywhere; we'd find "most recent open for operator" | require thread context; resolved via `findOpenByThread` |
| Operator UX | future "Connect Slack" button on `/settings` | not needed; HITL is invisible to operator |

### What stays

- `escalations` table (and its bridging columns: `slack_channel_id`,
  `slack_thread_ts`).
- `messages.slack_message_ts` back-reference.
- `SlackSignatureGuard` (HMAC v0 over `v0:<timestamp>:<rawBody>`), 5-minute
  replay window.
- All slash commands (`/bb resolve`, `/bb close-spam`, `/bb back-to-bot`,
  `/bb show-number`, `/bb book`).
- Action buttons on the parent message (Resume AI / Mark spam / Close /
  Show number).
- 8-second outbound SMS rate limit per conversation (CLAUDE.md §9.3).
- Email fallback path if Slack post fails (Slice 10 wires Resend).
- Audit log on `escalation.show_number`, `escalation.back_to_bot`,
  `escalation.resolve`.

## Consequences

**Positive**:
- Far less code: no OAuth controller, no state HMAC, no
  `SlackConnectionsService`, no encrypted-token-per-row.
- Matches the actual ops reality of MVP.
- No operator onboarding friction around Slack.
- The "Connect Slack" UX follow-up and channel-picker work are deleted from
  the backlog.

**Negative**:
- Doesn't scale beyond BB's internal ops headcount. If we ever onboard
  customers who *do* run their own ops team and want their own Slack, we'd
  need to re-introduce per-operator install. Cost of re-introduction is
  bounded — the bridging logic and tables don't change, only the
  config/source-of-bot-token layer.
- BB staff see *every* operator's escalations. Triage is by header content.
  Acceptable at MVP volumes; reconsider when one channel becomes noisy.

**Out of scope (deferred until volume justifies)**:
- Routing escalations into multiple channels by trade category
  (`#hitl-plumbing`, `#hitl-hvac`, …).
- Per-operator notification preferences.
- Operator-visible HITL surface in their own dashboard (the escalations table
  already supports it; just no UI yet).

## Rollback

Forward-only per CLAUDE.md §8. Reverting would require a new migration to
re-create `slack_connections`, restoring the install controller, and adding
back the channel-resolution code paths in webhook handlers. Not anticipated
for MVP horizon.

## Amendment (2026-05-12) — full conversation monitoring

Layered on top of the original ADR: every conversation, not just escalated
ones, gets a Slack thread the team can watch. Two channels in one workspace:

- **`#hitl`** (`SLACK_DEFAULT_CHANNEL_ID`) — escalation alarms + control
  buttons (Resume AI / Mark spam / Close / Show number). One short post per
  escalation, with a permalink to the convo thread.
- **`#convos`** (`SLACK_CONVOS_CHANNEL_ID`) — one thread per conversation,
  opened on first caller SMS. Caller SMS, bot replies, and agent
  interventions all post into this thread automatically. Source-of-truth
  transcript surface.

Migration `20260512000003_conversation_slack_thread.sql` adds nullable
`slack_channel_id` + `slack_thread_ts` to `conversations`. Failure to open a
thread (Slack down, env unset) is logged and swallowed — the conversation
continues without the thread (fail-soft).

Agent reply bridging routes by escalation thread first, then falls back to
matching the conversation by `(slack_channel_id, slack_thread_ts)`. Agents
can intervene in either channel at any time; no click-to-take-over is
required.

The "noisy at scale" concern is the same in shape but now split — `#hitl`
stays quiet (one alarm per escalation, not per call) while `#convos` gets
the full chatter and can be muted/scanned as a feed.
