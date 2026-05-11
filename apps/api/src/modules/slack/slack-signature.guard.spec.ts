import { createHmac } from 'node:crypto';

import type { ExecutionContext } from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';

import { AppError, WebhookSignatureError } from '../../common/errors/app-error';
import type { Env } from '../../config/env';

import { SlackSignatureGuard } from './slack-signature.guard';

function makeEnv(signingSecret: string | undefined): Env {
  return { SLACK_SIGNING_SECRET: signingSecret } as unknown as Env;
}

function makeLogger(): PinoLogger {
  return {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
  } as unknown as PinoLogger;
}

function makeCtx(req: {
  headers: Record<string, string | undefined>;
  rawBody?: Buffer;
}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

function sign(secret: string, ts: string, body: string): string {
  const mac = createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex');
  return `v0=${mac}`;
}

describe('SlackSignatureGuard', () => {
  const SECRET = 'fixture-signing-secret';
  const NOW_SEC = Math.floor(Date.now() / 1000);

  it('throws when SLACK_SIGNING_SECRET is missing', () => {
    const guard = new SlackSignatureGuard(makeEnv(undefined), makeLogger());
    expect(() =>
      guard.canActivate(makeCtx({ headers: {}, rawBody: Buffer.from('') })),
    ).toThrow(AppError);
  });

  it('accepts a correctly-signed body inside the 5-min window', () => {
    const guard = new SlackSignatureGuard(makeEnv(SECRET), makeLogger());
    const body = JSON.stringify({ challenge: 'abc' });
    const ts = String(NOW_SEC);
    const sig = sign(SECRET, ts, body);
    const result = guard.canActivate(
      makeCtx({
        headers: {
          'x-slack-signature': sig,
          'x-slack-request-timestamp': ts,
        },
        rawBody: Buffer.from(body),
      }),
    );
    expect(result).toBe(true);
  });

  it('rejects a stale timestamp (>5 min in the past)', () => {
    const guard = new SlackSignatureGuard(makeEnv(SECRET), makeLogger());
    const body = 'hi';
    const ts = String(NOW_SEC - 60 * 6);
    const sig = sign(SECRET, ts, body);
    expect(() =>
      guard.canActivate(
        makeCtx({
          headers: {
            'x-slack-signature': sig,
            'x-slack-request-timestamp': ts,
          },
          rawBody: Buffer.from(body),
        }),
      ),
    ).toThrow(WebhookSignatureError);
  });

  it('rejects a tampered body', () => {
    const guard = new SlackSignatureGuard(makeEnv(SECRET), makeLogger());
    const realBody = 'real';
    const ts = String(NOW_SEC);
    const sig = sign(SECRET, ts, realBody);
    expect(() =>
      guard.canActivate(
        makeCtx({
          headers: {
            'x-slack-signature': sig,
            'x-slack-request-timestamp': ts,
          },
          rawBody: Buffer.from('tampered'),
        }),
      ),
    ).toThrow(WebhookSignatureError);
  });

  it('rejects when signature is wrong format', () => {
    const guard = new SlackSignatureGuard(makeEnv(SECRET), makeLogger());
    const body = 'hi';
    const ts = String(NOW_SEC);
    expect(() =>
      guard.canActivate(
        makeCtx({
          headers: {
            'x-slack-signature': 'not-a-real-signature',
            'x-slack-request-timestamp': ts,
          },
          rawBody: Buffer.from(body),
        }),
      ),
    ).toThrow(WebhookSignatureError);
  });

  it('throws when raw body is missing (boot misconfiguration)', () => {
    const guard = new SlackSignatureGuard(makeEnv(SECRET), makeLogger());
    const ts = String(NOW_SEC);
    const sig = sign(SECRET, ts, '');
    expect(() =>
      guard.canActivate(
        makeCtx({
          headers: {
            'x-slack-signature': sig,
            'x-slack-request-timestamp': ts,
          },
          // rawBody intentionally omitted — simulates Nest booting without
          // rawBody:true, which the guard treats as a misconfiguration.
        }),
      ),
    ).toThrow(AppError);
  });

  it('rejects when headers are missing', () => {
    const guard = new SlackSignatureGuard(makeEnv(SECRET), makeLogger());
    expect(() =>
      guard.canActivate(makeCtx({ headers: {}, rawBody: Buffer.from('') })),
    ).toThrow(WebhookSignatureError);
  });
});
