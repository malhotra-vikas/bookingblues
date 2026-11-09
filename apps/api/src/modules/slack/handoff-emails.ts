/**
 * Emails sent when the bot hands a caller to a person ("I've passed your message
 * to the team — someone will reach out shortly"). The #hitl Slack alarm is the
 * team's main channel; these emails make sure the operator (who owns the
 * customer) and the KeeprSteady admins hear about it too, even when Slack is
 * down or nobody is watching it. Pure builders, no I/O.
 */
import parsePhoneNumber from 'libphonenumber-js';

import { brandedEmailHtml, escapeHtml } from '../../common/email/email-layout';
import { escalationHandoffSms } from '../conversations/templates/sms-templates';

export interface HandoffAudienceContent {
  /** Plain-English reason, no Slack markup. */
  readonly why: string;
  /** Extra steps after the standard "reply to the caller" / "pick it up in Slack" step. */
  readonly steps: ReadonlyArray<string>;
  /** Short technical note (admins only). */
  readonly technical?: string;
}

export interface HandoffEmailContent {
  readonly operator: HandoffAudienceContent;
  readonly admin: HandoffAudienceContent;
}

export interface HandoffEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

const TURN_CAP_PREFIX = 'turn_cap';

/** Email copy for a bot handoff that isn't a failed booking (escalate_to_human, turn cap). */
export function botHandoffEmailContent(reasonText: string): HandoffEmailContent {
  const why = reasonText.toLowerCase().startsWith(TURN_CAP_PREFIX)
    ? 'The conversation reached the message limit without a booking, so the assistant stopped and handed it to a person.'
    : `The assistant handed this caller to a person. Its note: “${reasonText.trim()}”`;
  return { operator: { why, steps: [] }, admin: { why, steps: [] } };
}

function formatPhone(e164: string): string {
  try {
    return parsePhoneNumber(e164)?.formatNational() ?? e164;
  } catch {
    return e164;
  }
}

function render(args: {
  heading: string;
  intro: string;
  facts: ReadonlyArray<[string, string]>;
  why: string;
  steps: ReadonlyArray<string>;
  technical?: string;
  cta: { label: string; href: string };
}): { html: string; text: string } {
  const factsHtml = args.facts
    .map(([k, v]) => `<strong>${escapeHtml(k)}:</strong> ${escapeHtml(v)}`)
    .join('<br>');
  const bodyHtml = [
    `<p style="margin:0 0 14px;">${escapeHtml(args.intro)}</p>`,
    `<p style="margin:0 0 14px;">${factsHtml}</p>`,
    `<p style="margin:0 0 6px;"><strong>Why:</strong> ${escapeHtml(args.why)}</p>`,
    `<p style="margin:14px 0 6px;"><strong>What to do:</strong></p>`,
    `<ol style="margin:0;padding-left:20px;">${args.steps.map((s) => `<li style="margin-bottom:6px;">${escapeHtml(s)}</li>`).join('')}</ol>`,
  ].join('');
  const text = [
    args.heading,
    '',
    args.intro,
    '',
    ...args.facts.map(([k, v]) => `${k}: ${v}`),
    '',
    `Why: ${args.why}`,
    '',
    'What to do:',
    ...args.steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    `${args.cta.label}: ${args.cta.href}`,
    ...(args.technical ? ['', `Technical: ${args.technical}`] : []),
  ].join('\n');
  return {
    html: brandedEmailHtml({
      heading: escapeHtml(args.heading),
      bodyHtml,
      cta: args.cta,
      ...(args.technical ? { footnoteHtml: `Technical: ${escapeHtml(args.technical)}` } : {}),
    }),
    text,
  };
}

export function handoffEmails(args: {
  businessName: string;
  callerPhoneE164: string;
  conversationId: string;
  operatorId: string;
  appUrl: string;
  content: HandoffEmailContent;
}): { operator: HandoffEmail; admin: HandoffEmail } {
  const phone = formatPhone(args.callerPhoneE164);
  const last4 = args.callerPhoneE164.slice(-4);
  const intro = `Our assistant couldn't finish with this caller and told them: “${escalationHandoffSms()}”`;

  const operator = render({
    heading: 'A caller needs you to follow up',
    intro,
    facts: [['Caller', phone]],
    why: args.content.operator.why,
    steps: [
      `Call or text the caller at ${phone}. Check the conversation first: the KeeprSteady team was alerted too and may already have texted them from your KeeprSteady number.`,
      ...args.content.operator.steps,
    ],
    cta: { label: 'View the conversation', href: `${args.appUrl}/conversations/${args.conversationId}` },
  });

  // Admins get the last 4 only: the full number sits behind the audit-logged
  // "Show number" button on the Slack alarm.
  const admin = render({
    heading: `${args.businessName}: a caller needs a human`,
    intro,
    facts: [
      ['Operator', args.businessName],
      ['Caller', `•••${last4}`],
      ['Conversation', args.conversationId.slice(0, 8)],
    ],
    why: args.content.admin.why,
    steps: [
      'Pick it up from the alert in Slack #hitl (reply in its thread to text the caller).',
      ...args.content.admin.steps,
    ],
    ...(args.content.admin.technical ? { technical: args.content.admin.technical } : {}),
    cta: { label: 'Open the operator in admin', href: `${args.appUrl}/admin/operators/${args.operatorId}` },
  });

  return {
    operator: { subject: `A caller needs a reply: ${phone}`, ...operator },
    admin: { subject: `[HITL] ${args.businessName}: caller •••${last4} needs a human`, ...admin },
  };
}
