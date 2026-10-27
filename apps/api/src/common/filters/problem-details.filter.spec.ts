import type { ArgumentsHost } from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';

import { ProblemDetailsFilter } from './problem-details.filter';

function run(exception: unknown): { status: number; body: Record<string, unknown> } {
  const out = { status: 0, body: {} as Record<string, unknown> };
  const res = {
    status(s: number) {
      out.status = s;
      return res;
    },
    type() {
      return res;
    },
    send(b: Record<string, unknown>) {
      out.body = b;
      return res;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ originalUrl: '/v1/x' }),
    }),
  } as unknown as ArgumentsHost;
  const logger = { setContext: jest.fn(), warn: jest.fn(), error: jest.fn() };
  new ProblemDetailsFilter(logger as unknown as PinoLogger).catch(exception, host);
  return out;
}

describe('ProblemDetailsFilter', () => {
  it('maps body-parser "entity too large" to 413, not 500', () => {
    const err = Object.assign(new Error('request entity too large'), {
      status: 413,
      statusCode: 413,
      expose: true,
      type: 'entity.too.large',
    });
    const { status, body } = run(err);
    expect(status).toBe(413);
    expect(body).toMatchObject({ code: 'http_413', title: 'Payload Too Large' });
  });

  it('keeps unknown errors as an opaque 500', () => {
    const { status, body } = run(new Error('db exploded'));
    expect(status).toBe(500);
    expect(body).toMatchObject({ code: 'internal', detail: 'An unexpected error occurred' });
  });

  it('does not expose a 5xx even when flagged expose', () => {
    const err = Object.assign(new Error('secret'), { status: 503, expose: true });
    expect(run(err).status).toBe(500);
  });
});
