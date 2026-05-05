import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import { AppError } from '../errors/app-error';

/**
 * AES-256-GCM at rest, with version-prefixed ciphertext so we can rotate keys
 * without re-encrypting all existing rows.
 *
 * Per CLAUDE.md §7 / §11.4: the encryption helper writes a key version on every
 * ciphertext. New writes use the FIRST entry in `ENCRYPTION_KEYS` (the active key).
 * Decryption picks the entry whose version matches the prefix; rows written with
 * older keys keep working until they are re-encrypted lazily on next write.
 *
 * Wire format: `v<version>:<iv_b64>:<tag_b64>:<ciphertext_b64>`
 *
 *   - `v` literal lets us evolve the format itself if we ever need to.
 *   - Base64 (not hex) keeps payloads compact in the DB.
 *   - GCM authentication tag is stored separately so we never confuse
 *     ciphertext-with-tag formats from different libraries.
 */
@Injectable()
export class EncryptionService {
  private readonly keys: ReadonlyArray<KeyEntry>;
  private readonly byVersion: Map<string, KeyEntry>;

  /**
   * The constructor is intentionally tolerant of a missing key so the API can
   * boot in dev for non-crypto work (health checks, schema introspection, etc).
   * Any actual encrypt/decrypt call without a registered key throws `crypto.no_keys`.
   * In production, env validation already requires ENCRYPTION_KEY, so we never
   * reach the deferred check there.
   */
  constructor(@Inject(ENV_TOKEN) env: Env) {
    this.keys = env.ENCRYPTION_KEYS;
    this.byVersion = new Map(env.ENCRYPTION_KEYS.map((k) => [k.version, k]));
  }

  encrypt(plaintext: string): string {
    const active = this.requireActiveKey();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', active.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v${active.version}:${b64(iv)}:${b64(tag)}:${b64(ct)}`;
  }

  decrypt(ciphertext: string): string {
    this.requireActiveKey();
    const parts = ciphertext.split(':');
    if (parts.length !== 4 || !parts[0]!.startsWith('v')) {
      throw new AppError({
        code: 'crypto.bad_format',
        status: 500,
        detail: 'Encrypted payload is not in the expected format',
      });
    }
    const [versionToken, ivB64, tagB64, ctB64] = parts as [string, string, string, string];
    const version = versionToken.slice(1);
    const entry = this.byVersion.get(version);
    if (!entry) {
      throw new AppError({
        code: 'crypto.unknown_key_version',
        status: 500,
        detail: `No key registered for version ${version}; cannot decrypt`,
      });
    }
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const ct = Buffer.from(ctB64, 'base64');
    if (iv.length !== IV_BYTES) {
      throw new AppError({
        code: 'crypto.bad_iv_length',
        status: 500,
        detail: 'Encrypted payload has an invalid IV length',
      });
    }
    const decipher = createDecipheriv('aes-256-gcm', entry.key, iv);
    decipher.setAuthTag(tag);
    try {
      const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
      return pt.toString('utf8');
    } catch (cause) {
      // GCM auth-tag mismatch — payload was tampered with or wrong key.
      throw new AppError({
        code: 'crypto.auth_failed',
        status: 500,
        detail: 'Encrypted payload failed authentication',
        cause,
      });
    }
  }

  /**
   * True if the ciphertext was written with the currently-active key.
   * Use this to opportunistically re-encrypt rows on next write during rotation.
   */
  isActiveVersion(ciphertext: string): boolean {
    const active = this.requireActiveKey();
    const prefix = ciphertext.split(':', 1)[0];
    return prefix === `v${active.version}`;
  }

  private requireActiveKey(): KeyEntry {
    const active = this.keys[0];
    if (!active) {
      throw new AppError({
        code: 'crypto.no_keys',
        status: 500,
        detail:
          'EncryptionService requires at least one ENCRYPTION_KEY entry. ' +
          'Set ENCRYPTION_KEY=<version>:<64-hex-chars> in your environment.',
      });
    }
    return active;
  }

  /**
   * Constant-time string equality for any callers that need to compare encrypted
   * payloads without leaking timing info (e.g. webhook id dedupe).
   */
  static safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }
}

interface KeyEntry {
  readonly version: string;
  readonly key: Buffer;
}

const IV_BYTES = 12; // GCM standard

function b64(buf: Buffer): string {
  return buf.toString('base64');
}
