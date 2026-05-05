/**
 * Per CLAUDE.md §15: errors are typed AppError subclasses; the global filter maps
 * to RFC 7807 Problem Details. Never throw raw strings.
 *
 * `code` is a stable, machine-readable identifier (e.g. `appointment.slot_taken`).
 * `status` is the HTTP status. `detail` is a human-readable explanation. `extensions`
 * carries any additional fields exposed in the response (validation errors, retry
 * hints, etc).
 */
export type ProblemExtensions = Readonly<Record<string, unknown>>;

export interface AppErrorOptions {
  readonly code: string;
  readonly status: number;
  readonly detail: string;
  readonly cause?: unknown;
  readonly extensions?: ProblemExtensions;
}

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: string;
  readonly extensions: ProblemExtensions;

  constructor(opts: AppErrorOptions) {
    super(opts.detail, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = new.target.name;
    this.code = opts.code;
    this.status = opts.status;
    this.detail = opts.detail;
    this.extensions = opts.extensions ?? {};
  }
}

export class ValidationError extends AppError {
  constructor(detail: string, extensions?: ProblemExtensions) {
    super({ code: 'validation_error', status: 400, detail, ...(extensions !== undefined ? { extensions } : {}) });
  }
}

export class UnauthorizedError extends AppError {
  constructor(detail = 'Authentication required') {
    super({ code: 'unauthorized', status: 401, detail });
  }
}

export class ForbiddenError extends AppError {
  constructor(detail = 'Forbidden') {
    super({ code: 'forbidden', status: 403, detail });
  }
}

export class NotFoundError extends AppError {
  constructor(detail = 'Not found') {
    super({ code: 'not_found', status: 404, detail });
  }
}

export class ConflictError extends AppError {
  constructor(detail: string, extensions?: ProblemExtensions) {
    super({ code: 'conflict', status: 409, detail, ...(extensions !== undefined ? { extensions } : {}) });
  }
}

export class RateLimitError extends AppError {
  constructor(detail = 'Rate limit exceeded', retryAfterSeconds?: number) {
    super({
      code: 'rate_limited',
      status: 429,
      detail,
      ...(retryAfterSeconds !== undefined
        ? { extensions: { retry_after_seconds: retryAfterSeconds } }
        : {}),
    });
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, detail: string, cause?: unknown) {
    super({
      code: `external.${service}`,
      status: 502,
      detail,
      ...(cause !== undefined ? { cause } : {}),
    });
  }
}

export class WebhookSignatureError extends AppError {
  constructor(source: string) {
    super({
      code: `webhook.${source}.bad_signature`,
      status: 400,
      detail: `Invalid ${source} webhook signature`,
    });
  }
}
