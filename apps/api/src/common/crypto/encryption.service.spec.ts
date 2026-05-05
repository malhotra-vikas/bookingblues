import { randomBytes } from 'node:crypto';

import { AppError } from '../errors/app-error';
import { loadEnv } from '../../config/env';

import { EncryptionService } from './encryption.service';

function expectAppErrorCode(fn: () => unknown, expected: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(expected);
    return;
  }
  throw new Error(`Expected to throw AppError with code ${expected}, but did not throw`);
}

function envWith(keys: string[]): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:3000',
    API_URL: 'http://localhost:3001',
    ENCRYPTION_KEY: keys.join(','),
  };
}

function key(version: string): string {
  return `${version}:${randomBytes(32).toString('hex')}`;
}

function makeService(keys: string[]): EncryptionService {
  const env = loadEnv(envWith(keys));
  return new EncryptionService(env);
}

describe('EncryptionService', () => {
  it('round-trips a string with the active key', () => {
    const svc = makeService([key('1')]);
    const ct = svc.encrypt('hello world');
    expect(ct.startsWith('v1:')).toBe(true);
    expect(svc.decrypt(ct)).toBe('hello world');
  });

  it('produces a different ciphertext each call (random IV)', () => {
    const svc = makeService([key('1')]);
    const a = svc.encrypt('same plaintext');
    const b = svc.encrypt('same plaintext');
    expect(a).not.toBe(b);
    expect(svc.decrypt(a)).toBe(svc.decrypt(b));
  });

  it('decrypts ciphertext written by an older registered key', () => {
    const k1 = key('1');
    const k2 = key('2');

    const svcOld = makeService([k1]);
    const oldCipher = svcOld.encrypt('legacy secret');

    // Rotate: v2 is now active; v1 still registered as decrypt-only.
    const svcNew = makeService([k2, k1]);
    expect(svcNew.decrypt(oldCipher)).toBe('legacy secret');

    // New writes use v2.
    const newCipher = svcNew.encrypt('new secret');
    expect(newCipher.startsWith('v2:')).toBe(true);
    expect(svcNew.isActiveVersion(oldCipher)).toBe(false);
    expect(svcNew.isActiveVersion(newCipher)).toBe(true);
  });

  it('rejects ciphertext from an unknown key version', () => {
    const svc = makeService([key('1')]);
    const orphan = `v9:${'A'.repeat(16)}:${'B'.repeat(22)}:${'C'.repeat(8)}`;
    expectAppErrorCode(() => svc.decrypt(orphan), 'crypto.unknown_key_version');
  });

  it('rejects tampered ciphertext (auth tag mismatch)', () => {
    const svc = makeService([key('1')]);
    const ct = svc.encrypt('do not tamper');
    const parts = ct.split(':');
    // Flip a bit in the ciphertext segment.
    const tampered = Buffer.from(parts[3]!, 'base64');
    tampered[0] = (tampered[0] ?? 0) ^ 0x01;
    parts[3] = tampered.toString('base64');
    expectAppErrorCode(() => svc.decrypt(parts.join(':')), 'crypto.auth_failed');
  });

  it('rejects malformed payloads', () => {
    const svc = makeService([key('1')]);
    expectAppErrorCode(() => svc.decrypt('not-encrypted'), 'crypto.bad_format');
    expectAppErrorCode(() => svc.decrypt('v1:only:two'), 'crypto.bad_format');
  });

  it('defers the no-keys error to first use so the API can boot in dev', () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      APP_URL: 'http://localhost:3000',
      API_URL: 'http://localhost:3001',
    });
    const svc = new EncryptionService(env);
    expectAppErrorCode(() => svc.encrypt('x'), 'crypto.no_keys');
    expectAppErrorCode(() => svc.decrypt('v1:a:b:c'), 'crypto.no_keys');
  });
});
