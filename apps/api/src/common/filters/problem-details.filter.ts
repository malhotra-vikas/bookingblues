import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { ZodError } from 'zod';

import { AppError, ValidationError } from '../errors/app-error';

/**
 * Per CLAUDE.md §10: errors serialize as RFC 7807 Problem Details JSON.
 *   {
 *     "type": "https://bookingblues.com/errors/<code>",
 *     "title": "<short reason>",
 *     "status": 400,
 *     "detail": "<human-readable explanation>",
 *     "instance": "<request path>",
 *     "code": "<machine-readable code>",
 *     ...extensions
 *   }
 *
 * Anything that isn't an AppError or HttpException becomes a 500 with the original
 * cause logged but never echoed to the client.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(ProblemDetailsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const problem = toProblem(exception, req.originalUrl || req.url);

    if (problem.status >= 500) {
      this.logger.error({ err: exception, problem }, problem.detail);
      // Report server-side failures to Sentry (no-op when DSN unset). The
      // beforeSend scrubber in instrument.ts strips PII; we only attach
      // non-sensitive correlation tags here. 4xx are client errors — not sent.
      const requestId = (req as Request & { id?: string }).id;
      Sentry.captureException(exception, {
        tags: { code: problem.code, ...(requestId ? { request_id: requestId } : {}) },
        extra: { path: problem.instance, status: problem.status },
      });
    } else {
      this.logger.warn({ problem }, problem.detail);
    }

    res
      .status(problem.status)
      .type('application/problem+json')
      .send(problem);
  }
}

interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance: string;
  readonly code: string;
  readonly [extension: string]: unknown;
}

function toProblem(exception: unknown, instance: string): ProblemDetails {
  if (exception instanceof AppError) {
    return {
      type: `https://bookingblues.com/errors/${exception.code}`,
      title: titleFor(exception.status),
      status: exception.status,
      detail: exception.detail,
      instance,
      code: exception.code,
      ...exception.extensions,
    };
  }

  if (exception instanceof ZodError) {
    const wrapped = new ValidationError('Request payload failed validation', {
      errors: exception.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
        code: e.code,
      })),
    });
    return toProblem(wrapped, instance);
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const body = exception.getResponse();
    const detail =
      typeof body === 'string'
        ? body
        : typeof body === 'object' && body !== null && 'message' in body
          ? String((body as { message: unknown }).message)
          : exception.message;
    return {
      type: `https://bookingblues.com/errors/http_${status}`,
      title: titleFor(status),
      status,
      detail,
      instance,
      code: `http_${status}`,
    };
  }

  return {
    type: 'https://bookingblues.com/errors/internal',
    title: 'Internal Server Error',
    status: 500,
    detail: 'An unexpected error occurred',
    instance,
    code: 'internal',
  };
}

function titleFor(status: number): string {
  if (status >= 500) return 'Internal Server Error';
  if (status === 404) return 'Not Found';
  if (status === 401) return 'Unauthorized';
  if (status === 403) return 'Forbidden';
  if (status === 409) return 'Conflict';
  if (status === 429) return 'Too Many Requests';
  if (status >= 400) return 'Bad Request';
  return 'Error';
}
