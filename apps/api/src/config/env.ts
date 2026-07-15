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
  // Six Stripe price IDs — one per (plan × cadence) combo. Created in the
  // Stripe Dashboard under three products (Solo / Crew / Fleet), each with a
  // monthly + annual recurring price. Resolved at checkout time via
  // `priceForPlan(plan, cadence)` in billing.service.ts. Required in
  // STRICT_ENV_REQUIRED mode (pre-launch lockdown).
  STRIPE_PRICE_SOLO_MONTHLY: z.string().optional(),
  STRIPE_PRICE_SOLO_ANNUAL: z.string().optional(),
  STRIPE_PRICE_CREW_MONTHLY: z.string().optional(),
  STRIPE_PRICE_CREW_ANNUAL: z.string().optional(),
  STRIPE_PRICE_FLEET_MONTHLY: z.string().optional(),
  STRIPE_PRICE_FLEET_ANNUAL: z.string().optional(),

  // Founding Member promo — $25 first month on MONTHLY plans for signups through
  // the end date. Per-plan Stripe `duration: once` coupons (amount_off =
  // planPrice − $25) applied to the first post-trial invoice. Unset = promo off.
  PROMO_FOUNDING_ENDS_AT: z.string().optional(), // ISO date, e.g. 2026-10-01T00:00:00-04:00
  STRIPE_COUPON_FOUNDING_SOLO: z.string().optional(),
  STRIPE_COUPON_FOUNDING_CREW: z.string().optional(),
  STRIPE_COUPON_FOUNDING_FLEET: z.string().optional(),

  // Stripe (booking-fee economics)
  PLATFORM_TAKE_RATE_BPS: z.coerce.number().int().min(0).max(10_000).default(1000),
  MIN_PLATFORM_FEE_CENTS: z.coerce.number().int().min(0).default(100),
  DEFAULT_BOOKING_FEE_CENTS: z.coerce.number().int().min(0).default(2500),
  TRIAL_DAYS: z.coerce.number().int().min(0).default(7),

  // Google OAuth
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().or(z.literal('')).optional(),

  // Email
  RESEND_API_KEY: z.string().optional(),
  // Verified sender. Format: `Display Name <addr@domain>` (Resend requires
  // the domain to be verified in the Resend dashboard).
  EMAIL_FROM: z.string().optional(),
  // Inbox that receives careers applications from /careers. Override per env.
  CAREERS_INBOX_EMAIL: z.string().email().default('apply@keeprsteady.com'),

  // Shared secret guarding internal cron endpoints (daily summary etc.).
  // External cron (Railway, EasyCron, etc.) sends `X-Cron-Secret: <value>`.
  CRON_SHARED_SECRET: z.string().optional(),

  // Crypto — required-format-if-present in dev, required in prod (see refine below)
  ENCRYPTION_KEY: z.string().optional(),

  // Observability
  SENTRY_DSN_API: z.string().optional(),

  // Telephony — staging outbound-SMS allowlist (CLAUDE.md §11.12)
  // Comma-separated E.164 numbers. Applied only when NODE_ENV !== 'production'.
  // Unset in non-prod = block-all (fail-safe).
  OUTBOUND_SMS_ALLOWLIST: z.string().optional(),

  // Slack (Slice 7.5 — HITL, ADR 0010).
  // Single BookingBlues-team workspace. Bot token + default channel id come
  // from env (no per-operator OAuth — every escalation posts into one #hitl
  // channel with operator + business in the header). SLACK_SIGNING_SECRET is
  // still required for inbound webhook signature verification.
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_DEFAULT_CHANNEL_ID: z.string().optional(),   // #hitl — escalation alarms + control buttons
  SLACK_CONVOS_CHANNEL_ID: z.string().optional(),    // #convos — per-conversation monitoring threads
  SLACK_CHANNEL_LEADS_ID: z.string().optional(),     // #bb-leads — new-signup notifications
  SLACK_SIGNING_SECRET: z.string().optional(),

  // Comma-separated category slugs allowed to be picked at signup / shown in
  // UI. Unset = all 5 seeded home-services trades enabled (plumbing, hvac,
  // electrical, roofing, garage_door) — the default for the multi-trade
  // product. Set explicitly only to constrain a launch to a subset; no DB
  // change needed either way. Operators already on a now-disabled category
  // are NOT migrated — they keep their existing category and prompt.
  ENABLED_CATEGORIES: z.string().optional(),

  // Public Calendly (or similar) URL surfaced as "Schedule a setup call with
  // our team" CTA on every step of the onboarding wizard. Per yesterday's
  // critical-path doc this is the single highest-conversion activation
  // lever. Empty = button hidden.
  SETUP_CALL_BOOKING_URL: z.string().url().or(z.literal('')).optional(),
});

/**
 * The full list of seeded category slugs (categories DB table). Mirrors the
 * 5 trades in `supabase/migrations/20260505000003_seed_categories.sql`.
 * When `ENABLED_CATEGORIES` env is unset we fall back to this set so existing
 * deployments don't quietly disable everything (the multi-trade default).
 */
export const ALL_SEEDED_CATEGORIES = [
  'plumbing',
  'hvac',
  'electrical',
  'roofing',
  'garage_door',
] as const satisfies ReadonlyArray<string>;

export type Env = Readonly<
  z.infer<typeof baseSchema> & {
    ENCRYPTION_KEYS: ReadonlyArray<{ version: string; key: Buffer }>;
    ENABLED_CATEGORY_SET: ReadonlySet<string>;
  }
>;

/**
 * The bare-minimum set required for the API to boot in production.
 * Every other provider (Twilio, Stripe, OpenAI, Google, Resend) is gated by a
 * deferred-error pattern in its service constructor — calls throw with a clear
 * `<provider>.no_credentials` error, so missing creds surface at first-use,
 * not at boot. Lets staging deploy with minimal creds and layer in providers
 * incrementally. Pre-launch, set STRICT_ENV_REQUIRED=true to lock down.
 */
const requiredInProd = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_JWT_SECRET',
  'ENCRYPTION_KEY',
] as const satisfies ReadonlyArray<keyof z.infer<typeof baseSchema>>;

/** Strict mode adds every provider; gate behind STRICT_ENV_REQUIRED=true for launch. */
const strictRequiredInProd = [
  ...requiredInProd,
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_API_KEY_SID',
  'TWILIO_API_KEY_SECRET',
  'OPENAI_API_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_CONNECT_WEBHOOK_SECRET',
  'STRIPE_PRICE_SOLO_MONTHLY',
  'STRIPE_PRICE_SOLO_ANNUAL',
  'STRIPE_PRICE_CREW_MONTHLY',
  'STRIPE_PRICE_CREW_ANNUAL',
  'STRIPE_PRICE_FLEET_MONTHLY',
  'STRIPE_PRICE_FLEET_ANNUAL',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_OAUTH_REDIRECT_URI',
  'RESEND_API_KEY',
] as const satisfies ReadonlyArray<keyof z.infer<typeof baseSchema>>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = baseSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${formatZodError(parsed.error)}`);
  }
  const env = parsed.data;

  if (env.NODE_ENV === 'production') {
    const strict = source.STRICT_ENV_REQUIRED === 'true';
    const required = strict ? strictRequiredInProd : requiredInProd;
    const missing = required.filter((k) => {
      const v = env[k];
      return v === undefined || v === '';
    });
    if (missing.length > 0) {
      throw new Error(
        `Missing required env in production${strict ? ' (strict mode)' : ''}: ${missing.join(', ')}. See CLAUDE.md §7.`,
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

  // Parse ENABLED_CATEGORIES into a Set. Default to all 5 if unset (legacy
  // deployments). Unknown slugs are silently dropped — if someone fat-fingers
  // `pluming` we don't want to enable everything by accident.
  const rawCategories = (env.ENABLED_CATEGORIES ?? '').trim();
  const enabledList =
    rawCategories === ''
      ? [...ALL_SEEDED_CATEGORIES]
      : rawCategories
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter((s): s is (typeof ALL_SEEDED_CATEGORIES)[number] =>
            (ALL_SEEDED_CATEGORIES as ReadonlyArray<string>).includes(s),
          );
  const ENABLED_CATEGORY_SET: ReadonlySet<string> = new Set(enabledList);
  if (ENABLED_CATEGORY_SET.size === 0) {
    throw new Error(
      `ENABLED_CATEGORIES yielded an empty set after filtering. Got: "${rawCategories}". Valid slugs: ${ALL_SEEDED_CATEGORIES.join(', ')}.`,
    );
  }

  return Object.freeze({ ...env, ENCRYPTION_KEYS, ENABLED_CATEGORY_SET });
}

function formatZodError(error: z.ZodError): string {
  return error.errors
    .map((e) => `  - ${e.path.join('.') || '<root>'}: ${e.message}`)
    .join('\n');
}
