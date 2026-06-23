import type { Request } from 'express';

import { ForbiddenError, NotFoundError, WebhookSignatureError } from '../../common/errors/app-error';
import type { TwilioService } from '../../common/twilio/twilio.service';
import type { SupabaseService } from '../../common/supabase/supabase.service';

export interface TwilioOperator {
  readonly id: string;
  readonly business_name: string;
  readonly category: string | null;
  readonly twilio_number_e164: string | null;
}

/**
 * Resolve operator and verify the inbound `To` matches their Twilio number
 * (CLAUDE.md §11.10). Throws 404 if operator unknown, 403 if number mismatch.
 */
export async function resolveOperatorForWebhook(args: {
  supabase: SupabaseService;
  operatorId: string;
  to: string | undefined;
}): Promise<TwilioOperator> {
  const { data, error } = await args.supabase
    .db()
    .from('operators')
    .select('id, business_name, category, twilio_number_e164')
    .eq('id', args.operatorId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError('Operator not found');
  if (!data.twilio_number_e164) {
    throw new NotFoundError('Operator has no Twilio number provisioned');
  }
  if (!args.to || args.to !== data.twilio_number_e164) {
    throw new ForbiddenError('Inbound webhook To does not match operator number');
  }
  return data;
}

export function verifyTwilioSignature(args: {
  twilio: TwilioService;
  apiUrl: string;
  req: Request;
  formBody: Record<string, string>;
}): void {
  const fullUrl = `${args.apiUrl}${args.req.originalUrl}`;
  const signature = args.req.header('x-twilio-signature') ?? undefined;
  const ok = args.twilio.validateSignature({
    signatureHeader: signature,
    fullUrl,
    formParams: args.formBody,
  });
  if (!ok) throw new WebhookSignatureError('twilio');
}

/**
 * Did the caller affirmatively opt in on the <Gather>? True only on DTMF '1' or
 * a clear affirmative spoken word. Default-deny: anything ambiguous, empty, or
 * negative returns false, so we never send SMS without express consent
 * (A2P 10DLC). Pure so the compliance branch is unit-testable in isolation.
 */
export function callerConsentedFromGather(digits?: string, speech?: string): boolean {
  if (digits?.trim() === '1') return true;
  if (speech && /\b(yes|yeah|yep|yup|sure|okay|ok|correct|go ahead)\b/i.test(speech)) {
    return true;
  }
  return false;
}

export function escapeXml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
