import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { FoundingPromoBanner } from '../../../../components/FoundingPromoBanner';
import { JsonLd } from '../../../../components/JsonLd';
import { BRAND } from '../../../../lib/brand';
import { getPromo } from '../../../../lib/plans';
import { TRADES, tradeBySlug } from '../../../../lib/trades';

export function generateStaticParams(): Array<{ trade: string }> {
  return TRADES.map((t) => ({ trade: t.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ trade: string }>;
}): Promise<Metadata> {
  const { trade } = await params;
  const t = tradeBySlug(trade);
  if (!t) return {};
  return {
    title: t.metaTitle,
    description: t.metaDescription,
    alternates: { canonical: `/for/${t.slug}` },
    openGraph: {
      title: t.metaTitle,
      description: t.metaDescription,
      url: `https://${BRAND.domain}/for/${t.slug}`,
    },
  };
}

export default async function TradePage({
  params,
}: {
  params: Promise<{ trade: string }>;
}): Promise<JSX.Element> {
  const { trade } = await params;
  const t = tradeBySlug(trade);
  if (!t) notFound();
  const promo = await getPromo();

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: t.faq.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
  // Service schema — describes the answering service for this specific trade so
  // AI engines can answer "answering service for {trade}" with KeeprSteady.
  const serviceJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: `AI answering service for ${t.plural.toLowerCase()}`,
    serviceType: 'AI answering & appointment-booking service',
    provider: { '@type': 'Organization', name: BRAND.name, url: `https://${BRAND.domain}` },
    areaServed: 'US',
    description: t.metaDescription,
    audience: { '@type': 'BusinessAudience', name: t.plural },
    url: `https://${BRAND.domain}/for/${t.slug}`,
  };

  return (
    <div className="px-6 py-12 max-w-4xl mx-auto">
      <JsonLd data={faqJsonLd} />
      <JsonLd data={serviceJsonLd} />
      <FoundingPromoBanner promo={promo} className="mb-8 max-w-2xl mx-auto" />

      {/* Hero */}
      <header className="text-center max-w-2xl mx-auto">
        <p className="text-xs font-semibold tracking-[0.16em] uppercase text-accent">
          For {t.plural}
        </p>
        <h1 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight text-ink dark:text-slate-100">
          {t.h1}
        </h1>
        <p className="mt-4 text-muted">{t.intro[0]}</p>
        <p className="mt-3 text-muted">{t.intro[1]}</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            href="/signup"
            className="inline-flex items-center justify-center rounded-xl bg-brand-sheen px-5 py-3 text-base font-semibold text-white no-underline shadow-glow transition-all duration-300 hover:-translate-y-0.5"
          >
            Start free trial →
          </Link>
          <a
            href={BRAND.demoBookingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 dark:border-slate-700 px-5 py-3 text-base font-semibold text-ink dark:text-slate-100 no-underline transition-all duration-300 hover:border-accent/40 hover:bg-accent-soft"
          >
            Book a 15-min demo
          </a>
        </div>
      </header>

      {/* Jobs + Emergencies */}
      <section className="mt-14 grid gap-4 sm:grid-cols-2">
        <Card title={`Jobs ${BRAND.name} books for you`}>
          {t.jobTypes.map((j) => (
            <Bullet key={j}>{j}</Bullet>
          ))}
        </Card>
        <Card title="Emergencies it catches instantly">
          {t.emergencies.map((e) => (
            <Bullet key={e}>{e}</Bullet>
          ))}
        </Card>
      </section>

      {/* Why */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold text-ink dark:text-slate-100">
          Why {t.plural.toLowerCase()} use {BRAND.name}
        </h2>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2 text-sm text-ink dark:text-slate-100">
          {t.benefits.map((b) => (
            <Bullet key={b}>{b}</Bullet>
          ))}
        </ul>
      </section>

      {/* How it works */}
      <section className="mt-10 rounded-2xl bg-slate-50 dark:bg-slate-900 p-6">
        <h2 className="text-xl font-semibold text-ink dark:text-slate-100">How it works</h2>
        <ol className="mt-4 space-y-2 text-sm text-muted list-decimal pl-5">
          <li>A customer calls your {t.business} and you can’t pick up.</li>
          <li>Their call forwards to your {BRAND.name} number, which texts them back in seconds.</li>
          <li>The AI asks the right questions, checks your calendar, and books the job.</li>
          <li>The appointment lands on your Google Calendar with the address and details.</li>
        </ol>
      </section>

      {/* FAQ */}
      <section className="mt-10">
        <h2 className="text-xl font-semibold text-ink dark:text-slate-100">Questions from {t.plural.toLowerCase()}</h2>
        <dl className="mt-4 space-y-4">
          {t.faq.map((f) => (
            <div key={f.q} className="border-t border-slate-200 dark:border-slate-800 pt-4">
              <dt className="font-medium text-ink dark:text-slate-100">{f.q}</dt>
              <dd className="mt-1 text-sm text-muted">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* CTA */}
      <section className="mt-12 text-center">
        <h2 className="text-2xl font-semibold text-ink dark:text-slate-100">
          Stop losing {t.plural.toLowerCase().replace(/s$/, '')} jobs to voicemail
        </h2>
        <p className="mt-2 text-muted">7-day free trial. No charge until day 8. Cancel in 2 clicks.</p>
        <Link
          href="/signup"
          className="mt-5 inline-flex items-center justify-center rounded-xl bg-brand-sheen px-6 py-3 text-base font-semibold text-white no-underline shadow-glow"
        >
          Start your free trial →
        </Link>
        <p className="mt-4 text-sm text-muted">
          See <Link href="/pricing" className="underline">pricing</Link> ·{' '}
          Also for{' '}
          {TRADES.filter((o) => o.slug !== t.slug).map((o, i, arr) => (
            <span key={o.slug}>
              <Link href={`/for/${o.slug}`} className="underline">
                {o.plural.toLowerCase()}
              </Link>
              {i < arr.length - 1 ? ', ' : ''}
            </span>
          ))}
        </p>
      </section>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 p-5">
      <p className="text-xs font-semibold tracking-[0.14em] uppercase text-accent">{title}</p>
      <ul className="mt-3 space-y-2 text-sm text-ink dark:text-slate-100">{children}</ul>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <li className="flex items-start gap-2">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-accent mt-1 shrink-0"
        aria-hidden="true"
      >
        <path d="m5 12 5 5L20 7" />
      </svg>
      <span>{children}</span>
    </li>
  );
}
