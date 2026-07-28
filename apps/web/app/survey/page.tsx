import type { Metadata } from 'next';

import { MissedCallsSurvey } from '../../components/survey/MissedCallsSurvey';
import { BRAND } from '../../lib/brand';

/**
 * Missed-calls questionnaire, served at https://missedcalls.keeprsteady.com
 * (middleware rewrites that host's root here) and linked from the outbound
 * lead email.
 *
 * noindex: this is a one-off research form for a specific email campaign. We
 * don't want it competing with the marketing site in search results, and a
 * crawlable copy on a second hostname would split ranking signals.
 */
export const metadata: Metadata = {
  // Bare title — the root layout's template appends "— KeeprSteady".
  title: 'Quick questions on missed calls',
  description:
    'Six quick questions about the calls your business misses. Takes about a minute — no signup, answer anonymously if you like.',
  robots: { index: false, follow: false },
  alternates: { canonical: `https://${BRAND.surveyHost}/` },
  openGraph: {
    title: `Quick questions on missed calls — ${BRAND.name}`,
    description: 'Six questions, about a minute. Helps us build the right thing for your trade.',
    url: `https://${BRAND.surveyHost}/`,
  },
};

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** First value of a query param, trimmed and length-capped. */
function param(
  sp: Record<string, string | string[] | undefined>,
  key: string,
  max: number,
): string {
  const raw = sp[key];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (v ?? '').trim().slice(0, max);
}

export default async function SurveyPage({ searchParams }: PageProps): Promise<JSX.Element> {
  const sp = await searchParams;
  // Prefill from the emailed link, e.g.
  // https://missedcalls.keeprsteady.com/?email=…&name=…&business=…&src=lead-email-jul
  const prefill = {
    email: param(sp, 'email', 160),
    name: param(sp, 'name', 120),
    business: param(sp, 'business', 160),
    source: param(sp, 'src', 60),
  };

  return (
    <div className="px-6 py-12 max-w-3xl mx-auto">
      <p className="text-xs font-semibold tracking-[0.16em] uppercase text-accent">
        {BRAND.name} · 1 minute
      </p>
      <h1 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tight text-ink dark:text-slate-100">
        How many jobs are your missed calls costing you?
      </h1>
      <p className="mt-3 text-muted">
        Six quick questions. We&apos;re building the AI dispatcher for home-service pros, and your
        answers decide what we build next. No signup, nothing to install — and you can answer
        anonymously.
      </p>

      <div className="mt-10">
        <MissedCallsSurvey prefill={prefill} />
      </div>
    </div>
  );
}
