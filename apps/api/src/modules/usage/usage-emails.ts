/**
 * Usage + billing alert emails (#usage-metering). Pure builders: every email has
 * an operator-facing version and a shorter internal version for KeeprSteady
 * admins. Bodies never include caller data — only counts and amounts.
 */
import { brandedEmailHtml, escapeHtml } from '../../common/email/email-layout';
import type { OverLimitPolicy, UsageAlertThreshold } from '../billing/plan-limits';
import { OVERAGE_BATCH_CENTS, OVERAGE_BATCH_SIZE } from '../billing/plan-limits';

export interface EmailContent {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export interface OperatorRef {
  readonly id: string;
  readonly businessName: string;
  readonly plan: string | null;
}

const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
const planName = (plan: string | null): string =>
  plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : 'your';
const dateLabel = (d: Date): string =>
  d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

const overageTerms = `$${OVERAGE_BATCH_CENTS / 100} per ${OVERAGE_BATCH_SIZE} extra people`;

export function usageAlertEmail(args: {
  operator: OperatorRef;
  threshold: UsageAlertThreshold;
  used: number;
  limit: number;
  policy: OverLimitPolicy;
  /** The free-trial cap (plan-limits.ts TRIAL_PEOPLE_LIMIT), not the plan limit. */
  trial?: boolean;
  resetsAt: Date;
  appUrl: string;
}): { operator: EmailContent; admin: EmailContent } {
  const { operator, threshold, used, limit, policy } = args;
  const plan = planName(operator.plan);
  const resets = dateLabel(args.resetsAt);
  const settingsUrl = `${args.appUrl}/settings`;

  if (args.trial) {
    return trialLimitEmail({ ...args, plan, dashboardUrl: `${args.appUrl}/dashboard` });
  }

  let heading: string;
  let detail: string;
  if (threshold === 100 && policy === 'block') {
    heading = `You've reached your ${plan} plan limit`;
    detail =
      `Your AI dispatcher has talked to ${used} of ${limit} people this month. ` +
      `New callers will no longer get the AI — they get a short text saying you'll call them back — ` +
      `until you upgrade to Crew or Fleet or your usage resets on ${resets}. ` +
      `People who already talked to the AI this month can keep texting it.`;
  } else if (threshold === 100) {
    heading = `You've reached your ${plan} plan limit`;
    detail =
      `Your AI dispatcher has talked to ${used} of ${limit} people this month. It keeps answering. ` +
      `Extra people are billed at ${overageTerms} on your next invoice. Usage resets on ${resets}.`;
  } else if (policy === 'block') {
    heading = `You've used ${threshold}% of your ${plan} plan`;
    detail =
      `Your AI dispatcher has talked to ${used} of ${limit} people this month. ` +
      `At ${limit}, new callers stop getting the AI until you upgrade or your usage resets on ${resets}. ` +
      `Upgrade to Crew to keep every caller covered.`;
  } else {
    heading = `You've used ${threshold}% of your ${plan} plan`;
    detail =
      `Your AI dispatcher has talked to ${used} of ${limit} people this month. ` +
      `Past ${limit}, it keeps answering and extra people are billed at ${overageTerms} on your next invoice. ` +
      `Usage resets on ${resets}.`;
  }

  const operatorEmail: EmailContent = {
    subject: heading,
    html: brandedEmailHtml({
      heading: escapeHtml(heading),
      bodyHtml: `<p>${escapeHtml(detail)}</p>`,
      cta: { label: policy === 'block' ? 'Upgrade plan' : 'View plan', href: settingsUrl },
    }),
    text: `${heading}\n\n${detail}\n\n${settingsUrl}`,
  };

  const adminSubject = `[Usage ${threshold}%] ${operator.businessName} — ${used}/${limit} people (${plan})`;
  const adminDetail =
    policy === 'block' && threshold === 100
      ? 'Solo limit reached: new callers are no longer getting the AI until they upgrade or the window resets.'
      : policy === 'block'
        ? 'Solo plan nearing its limit — a good moment to suggest Crew.'
        : 'Overage will be billed on their next invoice if they go past the limit.';
  return {
    operator: operatorEmail,
    admin: adminEmail(adminSubject, `${adminDetail} Usage resets ${resets}.`, operator, args.appUrl),
  };
}

function trialLimitEmail(args: {
  operator: OperatorRef;
  threshold: UsageAlertThreshold;
  used: number;
  limit: number;
  plan: string;
  dashboardUrl: string;
  appUrl: string;
}): { operator: EmailContent; admin: EmailContent } {
  const { operator, threshold, used, limit, plan } = args;
  const reached = threshold === 100;
  const heading = reached
    ? `You've reached the free-trial limit of ${limit} people`
    : `You've used ${threshold}% of your free trial`;
  const detail =
    `Your AI dispatcher has talked to ${used} of the ${limit} people included in your free trial. ` +
    (reached
      ? `New callers no longer get the AI — they get a short text saying you'll call them back. `
      : `At ${limit}, new callers stop getting the AI until your trial ends. `) +
    `People who already talked to the AI can keep texting it. ` +
    `End your trial now to start your ${plan} plan and unlock its full monthly limit right away.`;
  const operatorEmail: EmailContent = {
    subject: heading,
    html: brandedEmailHtml({
      heading: escapeHtml(heading),
      bodyHtml: `<p>${escapeHtml(detail)}</p>`,
      cta: { label: 'End trial and start plan', href: args.dashboardUrl },
    }),
    text: `${heading}\n\n${detail}\n\n${args.dashboardUrl}`,
  };
  const adminSubject = `[Trial ${threshold}%] ${operator.businessName} — ${used}/${limit} people (${plan} trial)`;
  const adminDetail = reached
    ? 'Trial cap reached: new callers are no longer getting the AI until they end the trial.'
    : 'Trial nearing its cap — a good moment to suggest starting the plan.';
  return {
    operator: operatorEmail,
    admin: adminEmail(adminSubject, adminDetail, operator, args.appUrl),
  };
}

export function paymentFailedEmail(args: {
  operator: OperatorRef;
  amountDueCents: number;
  payUrl: string | null;
  isOverageInvoice: boolean;
  appUrl: string;
}): { operator: EmailContent; admin: EmailContent } {
  const what = args.isOverageInvoice ? 'usage overage charge' : 'subscription payment';
  const heading = `Your ${what} of ${usd(args.amountDueCents)} failed`;
  const detail =
    `We couldn't charge the card on file for your ${what}. Your AI dispatcher is paused: ` +
    `callers still get your greeting and a text saying you'll follow up, but the AI won't book jobs ` +
    `until the payment goes through. Update your card or pay the invoice to resume.`;
  const href = args.payUrl ?? `${args.appUrl}/settings`;
  return {
    operator: {
      subject: heading,
      html: brandedEmailHtml({
        heading: escapeHtml(heading),
        bodyHtml: `<p>${escapeHtml(detail)}</p>`,
        cta: { label: args.payUrl ? 'Pay invoice' : 'Update payment method', href },
      }),
      text: `${heading}\n\n${detail}\n\n${href}`,
    },
    admin: adminEmail(
      `[Payment failed] ${args.operator.businessName} — ${what} ${usd(args.amountDueCents)}`,
      'AI dispatcher paused until the invoice is paid.',
      args.operator,
      args.appUrl,
    ),
  };
}

export function accountResumedEmail(args: {
  operator: OperatorRef;
  appUrl: string;
}): { operator: EmailContent; admin: EmailContent } {
  const heading = 'Payment received — your AI dispatcher is back on';
  const detail = 'Thanks! Your payment went through and the AI is booking jobs again.';
  return {
    operator: {
      subject: heading,
      html: brandedEmailHtml({
        heading: escapeHtml(heading),
        bodyHtml: `<p>${escapeHtml(detail)}</p>`,
        cta: { label: 'Open dashboard', href: `${args.appUrl}/dashboard` },
      }),
      text: `${heading}\n\n${detail}`,
    },
    admin: adminEmail(
      `[Resumed] ${args.operator.businessName} — payment received`,
      'Payment went through; the AI dispatcher is active again.',
      args.operator,
      args.appUrl,
    ),
  };
}

function adminEmail(subject: string, detail: string, operator: OperatorRef, appUrl: string): EmailContent {
  const href = `${appUrl}/admin/operators/${operator.id}`;
  return {
    subject,
    html: brandedEmailHtml({
      heading: escapeHtml(operator.businessName),
      bodyHtml: `<p>${escapeHtml(subject)}</p><p>${escapeHtml(detail)}</p>`,
      cta: { label: 'Open in admin', href },
    }),
    text: `${subject}\n\n${detail}\n\n${href}`,
  };
}
