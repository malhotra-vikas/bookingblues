import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PinoLogger } from 'nestjs-pino';
import type { Json } from '@bookingblues/db-types';

import { ValidationError } from '../../common/errors/app-error';
import { WebhookIdempotencyService } from '../../common/webhooks/webhook-idempotency.service';

import { SupabaseService } from '../../common/supabase/supabase.service';
import { BookingsService } from '../appointments/bookings.service';
import { buildLeadBlocks } from '../leads/leads.controller';

import { EscalationsService } from './escalations.service';
import { SlackApiClient } from './slack-api.client';
import { SlackSignatureGuard } from './slack-signature.guard';

interface SlackEventEnvelope {
  type?: 'url_verification' | 'event_callback';
  challenge?: string;
  team_id?: string;
  event_id?: string;
  event?: {
    type?: string;
    subtype?: string;
    bot_id?: string;
    user?: string;
    text?: string;
    channel?: string;
    ts?: string;
    thread_ts?: string;
  };
}

interface SlackSlashCommandBody {
  token?: string;
  team_id?: string;
  channel_id?: string;
  thread_ts?: string;
  user_id?: string;
  user_name?: string;
  command?: string;
  text?: string;
  response_url?: string;
  trigger_id?: string;
}

interface SlackInteractivityPayload {
  type?: 'block_actions' | 'view_submission';
  team?: { id?: string };
  user?: { id?: string; username?: string };
  channel?: { id?: string };
  message?: { ts?: string; thread_ts?: string };
  actions?: Array<{ action_id?: string; value?: string; type?: string }>;
  // Slack supplies a short-lived URL (~30min) on every interactivity payload.
  // We ACK the webhook with 200 and POST the actual response here — direct
  // JSON responses to block_actions don't render reliably across clients.
  response_url?: string;
  trigger_id?: string;
  view?: {
    id?: string;
    callback_id?: string;
    private_metadata?: string;
    state?: {
      values?: Record<string, Record<string, { value?: string }>>;
    };
  };
}

interface ResumeAiModalMetadata {
  escalationId: string;
  conversationId: string;
  responseUrl: string | null;
  channelId: string | null;
}

interface BookModalMetadata {
  conversationId: string;
  operatorId: string;
  callerPhoneE164: string;
  /** Open escalation id if this booking is being made in an escalation context. */
  escalationId: string | null;
  responseUrl: string | null;
}

/**
 * Send the rendered response back to Slack via the payload's response_url.
 * For block_actions, Slack's response_url defaults `replace_original` to
 * `true` — which overwrites the parent message and makes the action buttons
 * vanish. We always force `replace_original: false` so the parent stays.
 */
async function postToResponseUrl(
  url: string,
  body: Record<string, unknown>,
): Promise<void> {
  await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ replace_original: false, ...body }),
  });
}

@Controller('webhooks/slack')
@SkipThrottle()
@UseGuards(SlackSignatureGuard)
export class SlackWebhooksController {
  constructor(
    private readonly escalations: EscalationsService,
    private readonly slackApi: SlackApiClient,
    private readonly bookings: BookingsService,
    private readonly supabase: SupabaseService,
    private readonly idempotency: WebhookIdempotencyService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SlackWebhooksController.name);
  }

  // ── Events API (message.channels, etc.) ────────────────────────────────

  @Post('events')
  @HttpCode(200)
  async events(@Body() body: SlackEventEnvelope): Promise<unknown> {
    if (body.type === 'url_verification') {
      return { challenge: body.challenge ?? '' };
    }
    if (body.type !== 'event_callback' || !body.event || !body.team_id || !body.event_id) {
      return { ok: true };
    }

    // Idempotency: Slack will retry on 5xx within 3s.
    const recorded = await this.idempotency.record({
      // Slack isn't yet in our typed WebhookSource union (just got added via
      // migration). Cast.
      source: 'slack' as unknown as 'twilio',
      eventId: body.event_id,
      payload: body as unknown as Json,
      signatureVerified: true,
    });
    if (recorded.status === 'duplicate') return { ok: true };

    try {
      // We care about thread replies that sit on top of an open escalation.
      // forwardAgentReplyToSms resolves the operator from the escalation row
      // (single platform workspace — channel alone no longer identifies the
      // operator). Bot's own messages are ignored.
      const ev = body.event;
      if (ev.type === 'message' && !ev.bot_id && ev.thread_ts && ev.channel && ev.user && ev.text && ev.ts) {
        const result = await this.escalations
          .forwardAgentReplyToSms({
            channelId: ev.channel,
            threadTs: ev.thread_ts,
            slackMessageTs: ev.ts,
            slackUserId: ev.user,
            text: ev.text,
          })
          .catch((err) => {
            this.logger.warn({ err: (err as Error).message }, 'forwardAgentReplyToSms failed');
            return { delivered: false, reason: 'exception' as const };
          });

        // Silent drops were the second confounder behind "SMS late or didn't
        // land". Surface the failure as an in-thread reply so the agent can
        // retry rather than think it went through.
        if (!result.delivered) {
          await this.postDeliveryFailure(ev.channel, ev.thread_ts, result.reason ?? 'unknown', ev.user).catch(
            () => undefined,
          );
        }
      }
      await this.idempotency.markProcessed(recorded.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.idempotency.markFailed(recorded.id, msg);
      this.logger.error({ err: msg }, 'Slack event handling failed');
    }
    return { ok: true };
  }

  // ── Slash commands ────────────────────────────────────────────────────

  @Post('commands')
  @HttpCode(200)
  async slashCommand(@Body() body: SlackSlashCommandBody): Promise<unknown> {
    const cmd = (body.command ?? '').trim();
    const sub = (body.text ?? '').trim();

    if (cmd !== '/bb') {
      return { response_type: 'ephemeral', text: `Unknown command ${cmd}` };
    }

    const [verb, ...rest] = sub.split(/\s+/);
    const arg = rest.join(' ').trim();

    if (verb === 'help' || !verb) {
      return {
        response_type: 'ephemeral',
        text:
          '`/bb resolve` — close this escalation (outcome=rejected)\n' +
          '`/bb close-spam` — close as spam\n' +
          '`/bb back-to-bot` — hand control back to the AI\n' +
          '`/bb show-number` — reveal the caller number (audit-logged)\n' +
          '`/bb book <ISO datetime>` — record a manual booking, bypassing the bot\n' +
          '_Run any command from inside the escalation thread._',
      };
    }

    // Resolve the escalation from the thread the command was fired in.
    // ADR 0010 — the platform-Slack model has many operators sharing one
    // channel, so we route by (channel, thread_ts), not by channel alone.
    const channelId = body.channel_id ?? '';
    const threadTs = body.thread_ts ?? '';
    if (!channelId || !threadTs) {
      return {
        response_type: 'ephemeral',
        text: 'Run `/bb` inside the escalation thread (so we know which conversation).',
      };
    }
    const esc = await this.escalations.findOpenByThread(channelId, threadTs);
    if (!esc) {
      return { response_type: 'ephemeral', text: 'No open escalation for this thread.' };
    }

    switch (verb) {
      case 'resolve':
        await this.escalations.resolveEscalation({
          escalationId: esc.id,
          resolvedByUserId: null,
          outcome: 'rejected',
          ...(arg ? { note: arg } : {}),
        });
        return { response_type: 'in_channel', text: `✅ Resolved escalation \`${esc.id.slice(0, 8)}\`.` };

      case 'close-spam':
        await this.escalations.resolveEscalation({
          escalationId: esc.id,
          resolvedByUserId: null,
          outcome: 'spam',
          ...(arg ? { note: arg } : {}),
        });
        return { response_type: 'in_channel', text: `🚫 Closed as spam.` };

      case 'back-to-bot':
        await this.escalations.backToBot({
          escalationId: esc.id,
          resolvedByUserId: null,
          ...(arg ? { note: arg } : {}),
        });
        return { response_type: 'in_channel', text: `↩ Bot resumed for this conversation.` };

      case 'show-number': {
        const num = await this.escalations.revealCallerNumber({
          escalationId: esc.id,
          requestedByUserId: null,
          requestedBySlackUserId: body.user_id ?? 'unknown',
        });
        return {
          response_type: 'ephemeral',
          text: `📞 Caller: ${num} (audit-logged)`,
        };
      }

      case 'book': {
        // Manual book — opens a modal regardless of whether there's an open
        // escalation. Falls back to looking up the conversation by thread so
        // /bb book works in plain #convos threads too.
        const triggerId = body.trigger_id;
        if (!triggerId) {
          return { response_type: 'ephemeral', text: 'Slack trigger expired — try again.' };
        }
        const lookup = await this.lookupThreadContext(channelId, threadTs);
        if (!lookup) {
          return {
            response_type: 'ephemeral',
            text: 'No matching conversation found for this thread.',
          };
        }
        await this.openBookingModal(triggerId, lookup);
        return { ok: true };
      }

      default:
        return { response_type: 'ephemeral', text: `Unknown subcommand: ${verb}. Try \`/bb help\`.` };
    }
  }

  // ── Interactivity (block actions) ──────────────────────────────────────

  @Post('interactivity')
  @HttpCode(200)
  async interactivity(@Body() body: { payload?: string }): Promise<unknown> {
    // Slack sends interactivity payloads as form-encoded with a single `payload`
    // JSON-string field.
    if (!body.payload) throw new ValidationError('Missing interactivity payload');
    let payload: SlackInteractivityPayload;
    try {
      payload = JSON.parse(body.payload) as SlackInteractivityPayload;
    } catch {
      throw new ValidationError('Interactivity payload was not JSON');
    }
    if (payload.type === 'view_submission') {
      return this.handleViewSubmission(payload);
    }
    if (payload.type !== 'block_actions' || !payload.actions?.length) {
      return { ok: true };
    }

    const action = payload.actions[0]!;
    const slackUserId = payload.user?.id ?? 'unknown';
    const slackUsername = payload.user?.username ?? null;
    const responseUrl = payload.response_url;
    this.logger.info(
      { actionId: action.action_id, slackUserId, hasResponseUrl: Boolean(responseUrl) },
      'slack interactivity click',
    );

    // Lead-claim from #bb-leads — branches before the escalation lookup since
    // a lead has no conversation.
    if (action.action_id === 'lead_claim') {
      const userId = action.value ?? '';
      if (!userId) return { ok: true };
      await this.handleLeadClaim({
        userId,
        slackUserId,
        slackUsername,
        responseUrl: responseUrl ?? null,
      });
      return { ok: true };
    }
    if (action.action_id === 'lead_view_in_admin') {
      // URL buttons are handled client-side by Slack; nothing to do.
      return { ok: true };
    }

    const conversationId = action.value ?? '';
    if (!conversationId) return { ok: true };

    const esc = await this.escalations.findOpenForConversation(conversationId);
    if (!esc) {
      if (responseUrl) {
        await postToResponseUrl(responseUrl, {
          response_type: 'ephemeral',
          text: 'This escalation is no longer open.',
        });
      }
      return { ok: true };
    }

    // We ACK Slack with `{ok:true}` and post the user-facing response via
    // response_url. Direct JSON responses to block_actions don't render
    // reliably (we hit this with show-number/close/resume-AI returning 200
    // but Slack showing the spinner resolve to nothing).
    switch (action.action_id) {
      case 'esc_back_to_bot': {
        // Open a modal so the agent can type a handoff message that goes to
        // the caller as SMS. Modal submit (handleViewSubmission) does the
        // actual SMS send + status flip; this branch only opens the view.
        const triggerId = payload.trigger_id;
        if (!triggerId) {
          // Trigger IDs expire fast (3s); if absent something else went
          // wrong. Fall back to the immediate flip.
          await this.escalations.backToBot({ escalationId: esc.id, resolvedByUserId: null });
          if (responseUrl) {
            await postToResponseUrl(responseUrl, {
              response_type: 'in_channel',
              text: `↩ <@${slackUserId}> resumed the bot.`,
            });
          }
          return { ok: true };
        }
        const metadata: ResumeAiModalMetadata = {
          escalationId: esc.id,
          conversationId: esc.conversation_id,
          responseUrl: responseUrl ?? null,
          channelId: payload.channel?.id ?? null,
        };
        await this.slackApi.openView({
          triggerId,
          view: {
            type: 'modal',
            callback_id: 'bb_resume_ai',
            private_metadata: JSON.stringify(metadata),
            title: { type: 'plain_text', text: 'Resume AI' },
            submit: { type: 'plain_text', text: 'Resume AI' },
            close: { type: 'plain_text', text: 'Cancel' },
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text:
                    'Optional handoff message to send to the caller as SMS *before* the AI takes back over. Leave blank to resume silently.',
                },
              },
              {
                type: 'input',
                block_id: 'handoff_block',
                optional: true,
                label: { type: 'plain_text', text: 'Message to caller' },
                element: {
                  type: 'plain_text_input',
                  action_id: 'handoff_text',
                  multiline: true,
                  max_length: 480,
                  placeholder: {
                    type: 'plain_text',
                    text: 'e.g. Thanks for waiting — our AI assistant will take it from here.',
                  },
                },
              },
            ],
          },
        });
        return { ok: true };
      }

      case 'esc_mark_spam':
        await this.escalations.resolveEscalation({
          escalationId: esc.id,
          resolvedByUserId: null,
          outcome: 'spam',
        });
        if (responseUrl) {
          await postToResponseUrl(responseUrl, {
            response_type: 'in_channel',
            text: `🚫 <@${slackUserId}> marked spam.`,
          });
        }
        return { ok: true };

      case 'esc_close':
        await this.escalations.resolveEscalation({
          escalationId: esc.id,
          resolvedByUserId: null,
          outcome: 'rejected',
        });
        if (responseUrl) {
          await postToResponseUrl(responseUrl, {
            response_type: 'in_channel',
            text: `✓ <@${slackUserId}> closed the escalation.`,
          });
        }
        return { ok: true };

      case 'esc_book': {
        const triggerId = payload.trigger_id;
        if (!triggerId) return { ok: true };
        await this.openBookingModal(triggerId, {
          conversationId: esc.conversation_id,
          operatorId: esc.operator_id,
          callerPhoneE164: esc.caller_phone_e164,
          escalationId: esc.id,
          responseUrl: responseUrl ?? null,
        });
        return { ok: true };
      }

      case 'esc_show_number': {
        const num = await this.escalations.revealCallerNumber({
          escalationId: esc.id,
          requestedByUserId: null,
          requestedBySlackUserId: slackUserId,
        });
        if (responseUrl) {
          await postToResponseUrl(responseUrl, {
            response_type: 'ephemeral',
            text: `📞 Caller: ${num} (audit-logged)`,
          });
        }
        return { ok: true };
      }

      default:
        return { ok: true };
    }
  }

  /**
   * Handle the Resume-AI modal submission. Responds with `{}` so Slack closes
   * the modal. The SMS send + status flip run before we respond so the
   * caller sees the handoff message before the AI's next turn.
   */
  private async handleViewSubmission(
    payload: SlackInteractivityPayload,
  ): Promise<Record<string, unknown>> {
    if (payload.view?.callback_id === 'bb_book') {
      return this.handleBookSubmission(payload);
    }
    if (payload.view?.callback_id !== 'bb_resume_ai') return {};

    let meta: ResumeAiModalMetadata;
    try {
      meta = JSON.parse(payload.view.private_metadata ?? '{}') as ResumeAiModalMetadata;
    } catch {
      this.logger.warn('resume-ai modal had unparseable private_metadata');
      return {};
    }

    const handoffText = (
      payload.view.state?.values?.handoff_block?.handoff_text?.value ?? ''
    ).trim();
    const slackUserId = payload.user?.id ?? 'unknown';

    this.logger.info(
      { escalationId: meta.escalationId, slackUserId, hasHandoff: Boolean(handoffText) },
      'slack resume-ai submission',
    );

    if (handoffText) {
      const send = await this.escalations.sendAgentSmsForEscalation({
        escalationId: meta.escalationId,
        text: handoffText,
      });
      if (!send.delivered) {
        // The SMS failed — return validation errors so the modal stays open
        // and the agent can decide what to do (retry / cancel).
        return {
          response_action: 'errors',
          errors: {
            handoff_block: `Could not send SMS (${send.reason ?? 'unknown'}). Resume cancelled.`,
          },
        };
      }
    }

    await this.escalations.backToBot({
      escalationId: meta.escalationId,
      resolvedByUserId: null,
      ...(handoffText ? { note: handoffText } : {}),
    });

    if (meta.responseUrl) {
      const tail = handoffText ? ' (handoff SMS sent)' : '';
      await postToResponseUrl(meta.responseUrl, {
        response_type: 'in_channel',
        text: `↩ <@${slackUserId}> resumed the bot${tail}.`,
      });
    }

    return {};
  }

  // ── Manual booking modal (/bb book + "📅 Book a slot" button) ──────────

  private async lookupThreadContext(
    channelId: string,
    threadTs: string,
  ): Promise<BookModalMetadata | null> {
    // Escalation thread first — the more specific surface — fall back to a
    // plain conversation thread in #convos.
    const esc = await this.escalations.findOpenByThread(channelId, threadTs);
    if (esc) {
      return {
        conversationId: esc.conversation_id,
        operatorId: esc.operator_id,
        callerPhoneE164: esc.caller_phone_e164,
        escalationId: esc.id,
        responseUrl: null,
      };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = this.supabase.db() as any;
    const { data, error } = await client
      .from('conversations')
      .select('id, operator_id, caller_phone_e164')
      .eq('slack_channel_id', channelId)
      .eq('slack_thread_ts', threadTs)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      conversationId: data.id,
      operatorId: data.operator_id,
      callerPhoneE164: data.caller_phone_e164,
      escalationId: null,
      responseUrl: null,
    };
  }

  private async openBookingModal(triggerId: string, meta: BookModalMetadata): Promise<void> {
    // Default the slot to "tomorrow at 9 AM operator-local" — convenient
    // baseline the agent usually only needs to nudge.
    const tomorrow9 = new Date(Date.now() + 24 * 60 * 60 * 1000);
    tomorrow9.setUTCHours(13, 0, 0, 0); // 9am ET-ish; agent will adjust as needed
    const initialTs = Math.floor(tomorrow9.getTime() / 1000);
    await this.slackApi.openView({
      triggerId,
      view: {
        type: 'modal',
        callback_id: 'bb_book',
        private_metadata: JSON.stringify(meta),
        title: { type: 'plain_text', text: 'Book appointment' },
        submit: { type: 'plain_text', text: 'Book' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text:
                'Books the appointment in the operator\'s calendar and texts the caller a tap-to-add calendar link. 60-minute slot.',
            },
          },
          {
            type: 'input',
            block_id: 'start',
            label: { type: 'plain_text', text: 'Start time' },
            element: {
              type: 'datetimepicker',
              action_id: 'start_ts',
              initial_date_time: initialTs,
            },
          },
          {
            type: 'input',
            block_id: 'caller_name',
            label: { type: 'plain_text', text: 'Caller name' },
            element: {
              type: 'plain_text_input',
              action_id: 'caller_name_input',
              max_length: 120,
              placeholder: { type: 'plain_text', text: 'e.g. Jane Doe' },
            },
          },
          {
            type: 'input',
            block_id: 'job_summary',
            label: { type: 'plain_text', text: 'Job summary' },
            element: {
              type: 'plain_text_input',
              action_id: 'job_summary_input',
              multiline: true,
              max_length: 500,
              placeholder: {
                type: 'plain_text',
                text: 'e.g. Dishwasher install + new wiring run',
              },
            },
          },
        ],
      },
    });
  }

  private async handleBookSubmission(
    payload: SlackInteractivityPayload,
  ): Promise<Record<string, unknown>> {
    let meta: BookModalMetadata;
    try {
      meta = JSON.parse(payload.view?.private_metadata ?? '{}') as BookModalMetadata;
    } catch {
      this.logger.warn('book modal had unparseable private_metadata');
      return {};
    }
    const v = payload.view?.state?.values ?? {};
    const startTs = Number(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (v.start?.start_ts as unknown as { selected_date_time?: number } | undefined)?.selected_date_time,
    );
    const callerName = (v.caller_name?.caller_name_input?.value ?? '').trim();
    const jobSummary = (v.job_summary?.job_summary_input?.value ?? '').trim();
    const slackUserId = payload.user?.id ?? 'unknown';

    const errors: Record<string, string> = {};
    if (!startTs || Number.isNaN(startTs)) errors.start = 'Pick a start time';
    if (!callerName) errors.caller_name = 'Required';
    if (!jobSummary) errors.job_summary = 'Required';
    if (Object.keys(errors).length > 0) {
      return { response_action: 'errors', errors };
    }

    const startIso = new Date(startTs * 1000).toISOString();
    const endIso = new Date((startTs + 60 * 60) * 1000).toISOString();

    // Load the operator row (needed for timezone + twilio number + business name).
    const { data: op, error: opErr } = await this.supabase
      .db()
      .from('operators')
      .select('*')
      .eq('id', meta.operatorId)
      .single();
    if (opErr) {
      return { response_action: 'errors', errors: { start: `Operator lookup failed: ${opErr.message}` } };
    }

    try {
      const result = await this.bookings.book({
        operator: op,
        conversationId: meta.conversationId,
        callerPhoneE164: meta.callerPhoneE164,
        callerName,
        jobSummary,
        startIso,
        endIso,
        bookedByUserId: null, // we don't map Slack user → auth.users id today
        // If §9.5 eligibility passes, the confirmation SMS carries the fee
        // checkout link alongside the calendar link. Eligibility fails →
        // silently no-fee, same as the AI tool path.
        chargeFeeIfEligible: true,
      });

      // Resolve the escalation (if any) — the booking is the resolution.
      if (meta.escalationId) {
        await this.escalations.resolveEscalation({
          escalationId: meta.escalationId,
          resolvedByUserId: null,
          outcome: 'booked',
        }).catch((err) => {
          this.logger.warn(
            { escalationId: meta.escalationId, err: (err as Error).message },
            'resolveEscalation after manual book failed (non-fatal)',
          );
        });
      }

      // Surface success back to the channel via response_url if we have one
      // (button-click path); otherwise just close the modal silently — the
      // confirmation SMS already went out.
      if (meta.responseUrl) {
        const feeNote = result.feeCheckoutUrl ? ' Booking-fee Checkout link sent.' : '';
        await postToResponseUrl(meta.responseUrl, {
          response_type: 'in_channel',
          text:
            `📅 <@${slackUserId}> booked ${callerName} for ${new Date(startIso).toUTCString()}. ` +
            `ICS link sent to caller.${feeNote}`,
        });
      }

      return {};
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn({ err: msg, meta }, 'manual book failed');
      return {
        response_action: 'errors',
        errors: { start: `Couldn't book: ${msg.slice(0, 180)}` },
      };
    }
  }

  /**
   * Sales team claims a lead from the #bb-leads channel. Upserts a row in
   * `lead_claims` keyed on the auth.users.id (passed as the button's value),
   * then replaces the Slack message to show who owns it. Re-claims are
   * allowed but rare — the upsert just rewrites the ownership row.
   */
  private async handleLeadClaim(args: {
    userId: string;
    slackUserId: string;
    slackUsername: string | null;
    responseUrl: string | null;
  }): Promise<void> {
    // Look up the lead for re-rendering the message — auth.users + operator
    // metadata. The original post embedded all of these in the blocks, but
    // Slack hands us only the action.value (user_id), not the prior blocks.
    const { data: userResp, error: userErr } = await this.supabase
      .db()
      .auth.admin.getUserById(args.userId);
    if (userErr || !userResp?.user) {
      this.logger.warn({ err: userErr?.message, userId: args.userId }, 'lead_claim: user not found');
      if (args.responseUrl) {
        await postToResponseUrl(args.responseUrl, {
          response_type: 'ephemeral',
          text: ":x: Couldn't find that lead anymore (was the account deleted?)",
        });
      }
      return;
    }
    const u = userResp.user;
    const email = u.email ?? '(no email)';
    const meta = (u.user_metadata ?? {}) as { business_name?: string; personal_phone_e164?: string };
    const businessName = meta.business_name ?? '(unnamed)';
    const phoneE164 = meta.personal_phone_e164 ?? '+10000000000';

    const { error: upsertErr } = await this.supabase
      .db()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('lead_claims' as any)
      .upsert(
        {
          user_id: args.userId,
          claimed_by_slack_user_id: args.slackUserId,
          claimed_by_slack_username: args.slackUsername,
          claimed_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
    if (upsertErr) {
      this.logger.error({ err: upsertErr.message, userId: args.userId }, 'lead_claim: upsert failed');
      if (args.responseUrl) {
        await postToResponseUrl(args.responseUrl, {
          response_type: 'ephemeral',
          text: `:x: Couldn't save the claim: ${upsertErr.message}`,
        });
      }
      return;
    }

    // Replace the original message: keep the lead info, swap the action row
    // for a "claimed by …" banner. We force `replace_original: true` here
    // (overriding the global helper's `false`) because we want the buttons
    // to vanish once claimed — otherwise two agents can both "claim" and
    // race.
    const baseBlocks = buildLeadBlocks({
      userId: args.userId,
      email,
      businessName,
      phoneE164,
      adminUrl: '', // unused — we strip the actions row below
    });
    // Drop the original actions block and replace with the claimed banner.
    const withoutActions = baseBlocks.filter(
      (b) => (b as { type?: string }).type !== 'actions',
    );
    const claimedBlocks = [
      ...withoutActions,
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `:lock: Claimed by <@${args.slackUserId}> · ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC`,
          },
        ],
      },
    ];

    if (args.responseUrl) {
      await fetch(args.responseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          replace_original: true,
          text: `New lead — ${businessName} · claimed by <@${args.slackUserId}>`,
          blocks: claimedBlocks,
        }),
      });
    }
  }

  /**
   * Post an in-thread reply when a bridge attempt failed, so the agent
   * knows their message didn't go out and can retry. We don't have a
   * response_url here (events webhooks don't carry one), so a regular
   * thread reply is the visible-to-thread option.
   */
  private async postDeliveryFailure(
    channelId: string,
    threadTs: string,
    reason: string,
    slackUserId: string,
  ): Promise<void> {
    const friendly = (
      {
        rate_limited:
          '⏳ Rate-limited (1 SMS / 8s per conversation, CLAUDE §9.3). Wait ~8 seconds, then retry.',
        no_open_escalation:
          "⚠ No open escalation OR conversation thread match for this thread. Can't bridge to SMS.",
        no_matching_thread:
          "⚠ Couldn't match this thread to a conversation — was the thread opened by BookingBlues?",
        no_operator_number: '⚠ Operator has no Twilio number assigned — SMS not sent.',
        exception: '⚠ Internal error while bridging to SMS — check Railway logs.',
      } as Record<string, string>
    )[reason] ?? `⚠ Bridge failed (${reason}). SMS not sent.`;
    await this.slackApi.postMessage({
      channel: channelId,
      threadTs,
      text: `<@${slackUserId}> heads up: ${friendly}`,
    });
  }
}

