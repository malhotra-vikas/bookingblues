import crypto from 'node:crypto';

import { ValidationError } from '../../common/errors/app-error';

/**
 * State token used for the Google OAuth dance. Format:
 *   `<user_id>.<expiry_unix>.<nonce>.<hmac_sha256>`
 *
 * The HMAC binds the user_id+expiry+nonce so an attacker cannot swap the
 * user_id and steal someone else's calendar grant. The nonce stops same-user
 * replay between two concurrent connect attempts.
 */
const STATE_TTL_SECONDS = 10 * 60;

export function signState(args: {
  userId: string;
  secret: string;
  nowMs?: number;
}): string {
  const expiry = Math.floor((args.nowMs ?? Date.now()) / 1000) + STATE_TTL_SECONDS;
  const nonce = crypto.randomBytes(8).toString('hex');
  const payload = `${args.userId}.${expiry}.${nonce}`;
  const sig = crypto.createHmac('sha256', args.secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export interface VerifiedState {
  readonly userId: string;
  readonly expiry: number;
}

export function verifyState(args: {
  state: string;
  secret: string;
  nowMs?: number;
}): VerifiedState {
  const parts = args.state.split('.');
  if (parts.length !== 4) throw new ValidationError('Malformed OAuth state');
  const [userId, expiryStr, nonce, sig] = parts as [string, string, string, string];

  const payload = `${userId}.${expiryStr}.${nonce}`;
  const expectedSig = crypto
    .createHmac('sha256', args.secret)
    .update(payload)
    .digest('base64url');
  if (
    sig.length !== expectedSig.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))
  ) {
    throw new ValidationError('OAuth state signature mismatch');
  }

  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry)) throw new ValidationError('Malformed OAuth state expiry');
  const nowSec = Math.floor((args.nowMs ?? Date.now()) / 1000);
  if (nowSec >= expiry) throw new ValidationError('OAuth state expired');

  return { userId, expiry };
}
