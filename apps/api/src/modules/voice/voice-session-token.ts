import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Short-lived token passed to Twilio as a <Stream> <Parameter>. Twilio sends it
 * back in the stream's `start` message, so only a stream we set up for this
 * exact call can attach to the voice bridge. Signed with the Twilio auth token,
 * the same secret that authenticates every other Twilio webhook.
 */
const TTL_MS = 5 * 60_000;

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createVoiceToken(args: {
  callSid: string;
  operatorId: string;
  secret: string;
  now?: number;
}): string {
  const exp = (args.now ?? Date.now()) + TTL_MS;
  const payload = `${args.callSid}.${args.operatorId}.${exp}`;
  return `${Buffer.from(payload).toString('base64url')}.${sign(payload, args.secret)}`;
}

/** Returns the operator id when the token is valid for this call, else null. */
export function verifyVoiceToken(args: {
  token: string | undefined;
  callSid: string;
  secret: string;
  now?: number;
}): string | null {
  if (!args.token) return null;
  const [encoded, sig] = args.token.split('.');
  if (!encoded || !sig) return null;
  const payload = Buffer.from(encoded, 'base64url').toString();
  const expected = Buffer.from(sign(payload, args.secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const [callSid, operatorId, expRaw] = payload.split('.');
  if (!callSid || !operatorId || !expRaw) return null;
  if (callSid !== args.callSid) return null;
  if (Number(expRaw) < (args.now ?? Date.now())) return null;
  return operatorId;
}

/** Per-operator spike gate (`VOICE_AI_OPERATOR_IDS`: ids, or `*`). */
export function isVoiceAiEnabledFor(operatorId: string, setting: string | undefined): boolean {
  if (!setting) return false;
  const ids = setting.split(',').map((s) => s.trim()).filter(Boolean);
  return ids.includes('*') || ids.includes(operatorId);
}
