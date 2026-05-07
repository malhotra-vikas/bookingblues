import { z } from 'zod';

const PublicEnv = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_API_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  // Mirror of api PLATFORM_TAKE_RATE_BPS — used to render the fee math in the wizard.
  // Browser bundle only; the actual take is computed server-side by pricing.ts.
  NEXT_PUBLIC_PLATFORM_TAKE_RATE_BPS: z.coerce.number().int().min(0).max(10_000).default(1000),
  NEXT_PUBLIC_DEFAULT_BOOKING_FEE_CENTS: z.coerce.number().int().min(0).default(2500),
});

export type PublicEnv = z.infer<typeof PublicEnv>;

/**
 * Validates the NEXT_PUBLIC_* env vars surfaced to the browser bundle.
 * Loaded at module top-level so a misconfigured deploy fails loudly at boot.
 */
export const publicEnv: PublicEnv = (() => {
  const parsed = PublicEnv.safeParse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_PLATFORM_TAKE_RATE_BPS: process.env.NEXT_PUBLIC_PLATFORM_TAKE_RATE_BPS,
    NEXT_PUBLIC_DEFAULT_BOOKING_FEE_CENTS: process.env.NEXT_PUBLIC_DEFAULT_BOOKING_FEE_CENTS,
  });
  if (!parsed.success) {
    throw new Error(
      `Missing/invalid NEXT_PUBLIC_* env vars:\n${parsed.error.errors
        .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
        .join('\n')}`,
    );
  }
  return parsed.data;
})();
