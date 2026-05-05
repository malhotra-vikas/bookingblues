import { z } from 'zod';

/**
 * Per CLAUDE.md §7: API refuses to boot with missing or invalid env in production.
 * In development we relax non-load-bearing vars so a fresh clone can `pnpm dev`
 * without filling every Twilio/Stripe/Google credential up front.
 *
 * Required even in dev:
 *  - NODE_ENV, APP_URL, API_URL (basic plumbing)
 *  - ENCRYPTION_KEY format if provided (we never accept malformed keys)
 *
 * Required in production: every var listed in §7 with a non-empty value.
 */

const NodeEnv = z.enum(['development', 'production', 'test']);
const LogLevel = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']);

/**
 * Format: `<version>:<64-hex-chars>` e.g. `1:0123abcd...` (32 raw bytes for AES-256-GCM).
 * Versioning lets us rotate without downtime — see EncryptionService.
 * Multiple keys may be provided as comma-separated `1:hex,2:hex`; the first listed is the
 * current encryption key, the rest are decrypt-only.
 */
const EncryptionKeyEntry = z.string().regex(/^\d+:[\da-f]{64}$/i, {
  message: 'Each key must be `<version>:<64-hex-chars>` (32 bytes for AES-256-GCM)',
});
const EncryptionKey = z
  .string()
  .transform((s) => s.split(',').map((p) => p.trim()).filter(Boolean))
  .pipe(z.array(EncryptionKeyEntry).min(1));

const baseSchema = z.object({
  NODE_ENV: NodeEnv.default('development'),
  LOG_LEVEL: LogLevel.default('info'),
  PORT: z.coerce.number().int().positive().default(3001),

  APP_URL: z.string().url(),
  API_URL: z.string().url(),

  // Supabase
  SUPABASE_URL: z.string().url().or(z.literal('')).optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_JWT_SECRET: z.string().optional(),

  // Twilio
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_API_KEY_SID: z.string().optional(),
  TWILIO_API_KEY_SECRET: z.string().optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),

  // OpenAI
  OPENAI_API_KEY: z.string().optional(),

  // Stripe (platform)
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_CONNECT_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_STARTER: z.string().optional(),
  STRIPE_PRICE_PRO: z.string().optional(),

  // Stripe (booking-fee economics)
  PLATFORM_TAKE_RATE_BPS: z.coerce.number().int().min(0).max(10_000).default(1000),
  MIN_PLATFORM_FEE_CENTS: z.coerce.number().int().min(0).default(100),
  TRIAL_DAYS: z.coerce.number().int().min(0).default(7),

  // Google OAuth
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().or(z.literal('')).optional(),

  // Email
  RESEND_API_KEY: z.string().optional(),

  // Crypto — required-format-if-present in dev, required in prod (see refine below)
  ENCRYPTION_KEY: z.string().optional(),

  // Observability
  SENTRY_DSN_API: z.string().optional(),
});

export type Env = Readonly<
  z.infer<typeof baseSchema> & {
    ENCRYPTION_KEYS: ReadonlyArray<{ version: string; key: Buffer }>;
  }
>;

const requiredInProd = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_JWT_SECRET',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_API_KEY_SID',
  'TWILIO_API_KEY_SECRET',
  'OPENAI_API_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_CONNECT_WEBHOOK_SECRET',
  'STRIPE_PRICE_STARTER',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_OAUTH_REDIRECT_URI',
  'RESEND_API_KEY',
  'ENCRYPTION_KEY',
] as const satisfies ReadonlyArray<keyof z.infer<typeof baseSchema>>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = baseSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${formatZodError(parsed.error)}`);
  }
  const env = parsed.data;

  if (env.NODE_ENV === 'production') {
    const missing = requiredInProd.filter((k) => {
      const v = env[k];
      return v === undefined || v === '';
    });
    if (missing.length > 0) {
      throw new Error(
        `Missing required env in production: ${missing.join(', ')}. See CLAUDE.md §7.`,
      );
    }
  }

  // Encryption keys: required in prod, format-checked always when present.
  const keysRaw = env.ENCRYPTION_KEY ?? '';
  const ENCRYPTION_KEYS =
    keysRaw === ''
      ? []
      : EncryptionKey.parse(keysRaw).map((entry) => {
          const [version, hex] = entry.split(':');
          return { version: version!, key: Buffer.from(hex!, 'hex') };
        });

  if (env.NODE_ENV === 'production' && ENCRYPTION_KEYS.length === 0) {
    throw new Error('ENCRYPTION_KEY is required in production.');
  }

  return Object.freeze({ ...env, ENCRYPTION_KEYS });
}

function formatZodError(error: z.ZodError): string {
  return error.errors
    .map((e) => `  - ${e.path.join('.') || '<root>'}: ${e.message}`)
    .join('\n');
}
