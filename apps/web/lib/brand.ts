/**
 * Single source of truth for marketing copy that appears in more than one
 * place (header, footer, legal pages, metadata). Editing here updates every
 * page that imports these constants.
 */

export const BRAND = {
  name: 'KeeprSteady',
  // Registered legal entity behind the KeeprSteady product + the A2P 10DLC brand.
  // Shown site-wide (footer) so the website visibly matches the registered brand
  // for carrier/TCR vetting.
  legalEntity: 'Malhotra Consultants LLC',
  domain: 'keeprsteady.com',
  // Optional vanity alias for the missed-calls questionnaire. The page's real
  // home is keeprsteady.com/survey — Railway must register a custom domain
  // before it can terminate TLS for a hostname, so this subdomain only works if
  // it's either added in Railway (then middleware rewrites its root to /survey)
  // or redirected to the apex at the Cloudflare edge. See docs/SURVEY_SUBDOMAIN.md.
  surveyHost: 'missedcalls.keeprsteady.com',
  salesEmail: 'sales@keeprsteady.com',
  supportEmail: 'support@keeprsteady.com',
  applyEmail: 'apply@keeprsteady.com',
  careersBookingUrl: 'https://keeprsteady.zohobookings.com/#/4947805000000052008',
  demoBookingUrl: 'https://keeprsteady.zohobookings.com/#/4947805000000046045',
  linkedinUrl: 'https://www.linkedin.com/company/119484231',
  instagramUrl: 'https://www.instagram.com/keeprsteady/',
  xUrl: 'https://x.com/KeeprSteady',
} as const;

/**
 * Current Terms of Service / Privacy Policy version. Bump `version` whenever
 * the legal text materially changes — the middleware re-accept gate compares
 * each user's recorded `terms_version` against this and forces re-acceptance
 * on the next gated page load. Keep `version` === the effective date shown on
 * the /terms and /privacy pages so the recorded value matches what the user
 * actually saw.
 */
export const TERMS = {
  version: '2026-06-25',
  effectiveDate: 'June 25, 2026',
} as const;

export const TRIAL_COPY = {
  durationLabel: '7-day free trial',
  chargeReassurance: 'No charge until day 8 — cancel in 2 clicks from Settings.',
  cardOnFile: 'Card on file to start · Cancel in 2 clicks from Settings — no email, no phone call.',
} as const;

export type PlanSlug = 'solo' | 'crew' | 'fleet';

export interface Plan {
  slug: PlanSlug;
  name: string;
  /** One-line "who this is for" shown under the plan name on the pricing card. */
  tagline: string;
  monthlyPriceUsd: number;
  annualPriceUsd: number;
  conversationsPerMonth: number;
  approxMessagesPerMonth: number;
  // Take rate charged on top of the deposit (paid by the caller). Rewards scale —
  // bigger plan, smaller cut. Mirrors the API defaults in
  // apps/api/src/modules/billing/plan-policy.ts + env PLATFORM_TAKE_RATE_BPS_*.
  platformFeePct: 10 | 12 | 15;
  depositMode: 'off-by-default' | 'on-by-default' | 'mandatory';
  features: string[];
  recommended: boolean;
}

export const PLANS: readonly Plan[] = [
  {
    slug: 'solo',
    name: 'Solo',
    tagline: "For the solo operator who can't answer under a sink.",
    // NOTE: this is the fallback price only. The live price a visitor sees and
    // is charged comes from the Stripe Price behind STRIPE_PRICE_SOLO_MONTHLY /
    // _ANNUAL (read via /v1/plans). Updating the number here does NOT change
    // billing until the Stripe Price is updated too. Keep the two in sync.
    monthlyPriceUsd: 199,
    annualPriceUsd: 1_990,
    conversationsPerMonth: 80,
    approxMessagesPerMonth: 960,
    platformFeePct: 15,
    depositMode: 'off-by-default',
    features: [
      'Your own dedicated business text line',
      'AI qualifies, books & confirms every missed-call lead',
      'Google Calendar booking — no double-bookings',
      'Confirmation texts + email to you and the customer',
      'Overages: not available — upgrade to Crew',
    ],
    recommended: false,
  },
  {
    slug: 'crew',
    name: 'Crew',
    tagline: "For a growing team where the owner isn't the one answering.",
    monthlyPriceUsd: 650,
    annualPriceUsd: 6_500,
    conversationsPerMonth: 500,
    approxMessagesPerMonth: 6_000,
    platformFeePct: 12,
    depositMode: 'on-by-default',
    features: [
      'Everything in Solo',
      'Deposit collection on by default — lock in every booking',
      'Priority support',
      'Overages: $15 per batch of 50 conversations',
    ],
    recommended: true,
  },
  {
    slug: 'fleet',
    name: 'Fleet',
    tagline: 'For multi-crew and multi-location operations.',
    monthlyPriceUsd: 1_499,
    annualPriceUsd: 14_990,
    conversationsPerMonth: 1_500,
    approxMessagesPerMonth: 18_000,
    platformFeePct: 10,
    depositMode: 'mandatory',
    features: [
      'Everything in Crew',
      'Multi-location / multi-number support',
      'Dedicated account manager',
      'Overages: $15 per batch of 50 conversations',
    ],
    recommended: false,
  },
] as const;

export function depositLabel(mode: Plan['depositMode']): string {
  switch (mode) {
    case 'off-by-default':
      return 'Optional — enable anytime';
    case 'on-by-default':
      return 'On by default — disable in onboarding';
    case 'mandatory':
      return 'Mandatory — cannot be disabled';
  }
}
