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
  salesEmail: 'sales@keeprsteady.com',
  supportEmail: 'support@keeprsteady.com',
  careersEmail: 'careers@keeprsteady.com',
  // Cal.com URL doubles as the prod onboarding "schedule a setup call" link
  // (NEXT_PUBLIC_SETUP_CALL_BOOKING_URL). Marketing pages link directly so the
  // /contact and demo CTAs work even on static-rendered marketing routes.
  demoBookingUrl: 'https://cal.com/malhotra-vikas/intro-session-30-minutes',
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
  monthlyPriceUsd: number;
  annualPriceUsd: number;
  conversationsPerMonth: number;
  approxMessagesPerMonth: number;
  platformFeePct: 10 | 15 | 20;
  depositMode: 'off-by-default' | 'on-by-default' | 'mandatory';
  features: string[];
  recommended: boolean;
}

export const PLANS: readonly Plan[] = [
  {
    slug: 'solo',
    name: 'Solo',
    monthlyPriceUsd: 325,
    annualPriceUsd: 3_250,
    conversationsPerMonth: 80,
    approxMessagesPerMonth: 960,
    platformFeePct: 10,
    depositMode: 'off-by-default',
    features: [
      'One KeeprSteady number',
      'AI booking assistant',
      'Google Calendar integration',
      'Optional booking deposit via Stripe',
      'Overages: not available — upgrade to Crew',
    ],
    recommended: false,
  },
  {
    slug: 'crew',
    name: 'Crew',
    monthlyPriceUsd: 650,
    annualPriceUsd: 6_500,
    conversationsPerMonth: 500,
    approxMessagesPerMonth: 6_000,
    platformFeePct: 15,
    depositMode: 'on-by-default',
    features: [
      'Everything in Solo',
      'Priority support',
      'Deposit collection on by default (toggle off in onboarding)',
      'Overages: $15 per batch of 50 conversations',
    ],
    recommended: true,
  },
  {
    slug: 'fleet',
    name: 'Fleet',
    monthlyPriceUsd: 1_499,
    annualPriceUsd: 14_990,
    conversationsPerMonth: 1_500,
    approxMessagesPerMonth: 18_000,
    platformFeePct: 20,
    depositMode: 'mandatory',
    features: [
      'Everything in Crew',
      'Dedicated account manager',
      'Multi-location / multi-number support',
      'Deposit collection mandatory at this tier',
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
