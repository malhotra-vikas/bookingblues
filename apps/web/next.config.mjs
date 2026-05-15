/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@bookingblues/shared'],
  // Force build-time inlining of these public env vars. Turbopack (Next 16
  // default) doesn't always inline `process.env.NEXT_PUBLIC_X` when it's
  // accessed only inside an object-literal field in `lib/env.ts` — vars
  // referenced directly elsewhere (e.g. `process.env.NEXT_PUBLIC_SUPABASE_URL`
  // in middleware.ts) get inlined, but ones only seen through the
  // `publicEnv` zod schema don't. Declaring them here makes Next inject
  // them as compile-time constants everywhere. Confirmed via grepping the
  // production bundle on 2026-05-15.
  env: {
    NEXT_PUBLIC_ENABLED_CATEGORIES: process.env.NEXT_PUBLIC_ENABLED_CATEGORIES,
    NEXT_PUBLIC_SETUP_CALL_BOOKING_URL: process.env.NEXT_PUBLIC_SETUP_CALL_BOOKING_URL,
    NEXT_PUBLIC_PLATFORM_TAKE_RATE_BPS: process.env.NEXT_PUBLIC_PLATFORM_TAKE_RATE_BPS,
    NEXT_PUBLIC_DEFAULT_BOOKING_FEE_CENTS: process.env.NEXT_PUBLIC_DEFAULT_BOOKING_FEE_CENTS,
  },
};

export default nextConfig;
