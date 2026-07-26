import type { Metadata } from 'next';
import Link from 'next/link';

import { FoundingPromoBanner } from '../../../components/FoundingPromoBanner';
import { JsonLd } from '../../../components/JsonLd';
import { BRAND, TRIAL_COPY } from '../../../lib/brand';
import { getPlanPrices, getPromo, usd } from '../../../lib/plans';

export const metadata: Metadata = {
  title: 'KeeprSteady vs. Answering Services & AI Receptionists',
  description:
    'How KeeprSteady compares to Numa, Goodcall, Jobber AI Receptionist, and Smith.ai. The only one that qualifies the lead, books the job, and collects the deposit.',
  alternates: { canonical: '/comparison' },
};

/**
 * Competitor comparison. Cells reflect publicly documented capabilities as of
 * July 2026 and are intentionally conservative — competitor features and pricing
 * change often, so the page shows a "verify" note. The differentiators we lead
 * on (deposit collection at booking, human-in-the-loop monitoring, trade-specific
 * scoping) are KeeprSteady's, not knocks on anyone else.
 */
type Mark = 'yes' | 'no' | 'partial';

interface Column {
  name: string;
  /** Short "what it is" label under the name. */
  kind: string;
  highlight?: boolean;
}

const COLUMNS: readonly Column[] = [
  { name: 'KeeprSteady', kind: 'Missed-call → booked job', highlight: true },
  { name: 'Numa', kind: 'AI receptionist' },
  { name: 'Goodcall', kind: 'AI phone agent' },
  { name: 'Jobber AI', kind: 'Receptionist add-on' },
  { name: 'Smith.ai', kind: 'Human + AI answering' },
];

interface Row {
  label: string;
  /** One mark per COLUMN, in order. */
  marks: readonly Mark[];
  note?: string;
}

const ROWS: readonly Row[] = [
  {
    label: 'Texts missed callers back automatically',
    marks: ['yes', 'yes', 'partial', 'partial', 'partial'],
    note: 'Voice-first tools may call or voicemail rather than open an SMS thread.',
  },
  {
    label: 'Qualifies the lead to your specific trade',
    marks: ['yes', 'no', 'no', 'no', 'partial'],
    note: 'Most tools are general-purpose; KeeprSteady scopes each conversation to your trade.',
  },
  {
    label: 'Books the appointment on your calendar',
    marks: ['yes', 'yes', 'yes', 'yes', 'yes'],
  },
  {
    label: 'Collects a deposit at booking',
    marks: ['yes', 'no', 'no', 'no', 'no'],
    note: 'A booked job with money down is a job that shows up. This is what we do that they do not.',
  },
  {
    label: 'A human monitors & corrects the AI',
    marks: ['yes', 'no', 'no', 'no', 'yes'],
    note: 'Smith.ai is human-backed; the AI-only tools are unmonitored between calls.',
  },
  {
    label: 'Purpose-built for the trades',
    marks: ['yes', 'no', 'no', 'partial', 'no'],
  },
];

/** Sourced from public pricing pages, July 2026. Shown as "from". */
const START_PRICE: readonly string[] = ['', 'from $49/mo', 'from $59/mo', 'from $99/mo', 'from $95/mo'];

export default async function ComparisonPage(): Promise<JSX.Element> {
  const [prices, promo] = await Promise.all([getPlanPrices(), getPromo()]);
  const soloMonthly = prices.solo.monthlyUsd;

  const faq = [
    {
      q: 'Why does KeeprSteady cost more than a $49 AI receptionist?',
      a: `Because you are not buying answered calls — you are buying booked jobs with a deposit already down. One recovered $300–$1,500 job pays for months of the ${usd(soloMonthly)}/mo Solo plan. The cheaper tools take a message or book an unconfirmed slot; they do not lock in the money or filter the job to your trade.`,
    },
    {
      q: 'Do the other tools collect a deposit?',
      a: 'Not that we have found publicly documented as of July 2026. Deposit collection at booking is the core of what KeeprSteady does — it turns a soft "maybe" appointment into a committed job and cuts no-shows.',
    },
    {
      q: 'Is this a voice AI that answers the phone?',
      a: 'No. KeeprSteady works over SMS after a missed call, which is where homeowners actually engage. You forward busy/no-answer calls to your KeeprSteady number and the AI takes it from there by text.',
    },
  ];

  return (
    <div className="px-6 py-12 max-w-5xl mx-auto">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: faq.map((f) => ({
            '@type': 'Question',
            name: f.q,
            acceptedAnswer: { '@type': 'Answer', text: f.a },
          })),
        }}
      />

      <FoundingPromoBanner promo={promo} className="mb-8 max-w-2xl mx-auto" />

      <header className="text-center max-w-2xl mx-auto">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-ink dark:text-slate-100">
          The only one that collects the deposit before they hang up.
        </h1>
        <p className="mt-3 text-muted">
          Answering services take a message. AI receptionists book a slot. KeeprSteady qualifies the
          lead, books the job, <strong>and collects the deposit</strong> — so the appointment
          actually shows up. Here&rsquo;s how we stack up against the tools contractors compare us to.
        </p>
      </header>

      {/* ── Comparison table ────────────────────────────────────────────── */}
      <div className="mt-10 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="p-3 text-left align-bottom" />
              {COLUMNS.map((col) => (
                <th
                  key={col.name}
                  className={`p-3 text-center align-bottom rounded-t-xl ${
                    col.highlight
                      ? 'bg-brand-sheen text-white'
                      : 'text-ink dark:text-slate-100'
                  }`}
                >
                  <div className="font-display text-base font-semibold">{col.name}</div>
                  <div
                    className={`text-[11px] font-normal ${
                      col.highlight ? 'text-white/80' : 'text-muted'
                    }`}
                  >
                    {col.kind}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label} className="border-t border-slate-200 dark:border-slate-800">
                <td className="p-3 text-ink dark:text-slate-100">
                  <span className="font-medium">{row.label}</span>
                  {row.note ? (
                    <span className="block text-xs text-muted mt-0.5">{row.note}</span>
                  ) : null}
                </td>
                {row.marks.map((mark, i) => (
                  <td
                    key={COLUMNS[i]?.name ?? i}
                    className={`p-3 text-center ${
                      COLUMNS[i]?.highlight ? 'bg-accent-soft/50 dark:bg-slate-900' : ''
                    }`}
                  >
                    <MarkIcon mark={mark} />
                  </td>
                ))}
              </tr>
            ))}
            {/* Price row */}
            <tr className="border-t border-slate-200 dark:border-slate-800">
              <td className="p-3 font-medium text-ink dark:text-slate-100">Starting price</td>
              <td className="p-3 text-center bg-accent-soft/50 dark:bg-slate-900 font-semibold text-ink dark:text-slate-100">
                {usd(soloMonthly)}/mo
              </td>
              {START_PRICE.slice(1).map((p, i) => (
                <td key={COLUMNS[i + 1]?.name ?? i} className="p-3 text-center text-muted">
                  {p}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-muted max-w-3xl">
        <span className="font-semibold">✓</span> included &middot;{' '}
        <span className="font-semibold">◐</span> partial / varies &middot;{' '}
        <span className="font-semibold">—</span> not a documented feature. Competitor details and
        pricing reflect publicly available information as of July 2026 and change frequently —
        please verify current details on each provider&rsquo;s site.
      </p>

      {/* ── Why we cost more ────────────────────────────────────────────── */}
      <section className="mt-12 rounded-2xl border border-accent/20 bg-accent-soft/60 dark:bg-slate-900 dark:border-slate-800 p-6 max-w-3xl mx-auto">
        <p className="text-xs font-semibold tracking-[0.16em] uppercase text-accent mb-2">
          Priced per booked job, not per answered call
        </p>
        <p className="text-[15px] text-ink dark:text-slate-100 leading-relaxed">
          A $49 tool that takes a message still leaves you chasing callbacks and eating no-shows.
          KeeprSteady delivers a <strong>confirmed appointment with a deposit down</strong>. One
          recovered {usd(300)}–{usd(1_500)} job pays for months of Solo at {usd(soloMonthly)}/mo —
          the math works after a single missed call.
        </p>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────────────── */}
      <div className="mt-10 text-center">
        <Link
          href="/signup"
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-sheen px-6 py-3 text-base font-semibold text-white no-underline shadow-glow transition-all duration-300 hover:-translate-y-0.5 hover:shadow-card-hover"
        >
          Start your free trial
        </Link>
        <p className="mt-3 text-sm text-muted">
          {TRIAL_COPY.durationLabel}, no charge until day 8 &middot;{' '}
          <Link href="/pricing" className="underline">
            See full pricing
          </Link>
        </p>
      </div>

      {/* ── Mini FAQ ────────────────────────────────────────────────────── */}
      <section className="mt-16 max-w-2xl mx-auto">
        <h2 className="text-xl font-semibold text-ink dark:text-slate-100">Common questions</h2>
        <dl className="mt-6 space-y-4">
          {faq.map((item) => (
            <details
              key={item.q}
              className="group rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-ink dark:text-slate-100">
                <span>{item.q}</span>
                <span
                  aria-hidden="true"
                  className="text-muted transition-transform group-open:rotate-45 text-xl leading-none"
                >
                  +
                </span>
              </summary>
              <dd className="mt-3 text-sm text-muted leading-relaxed">{item.a}</dd>
            </details>
          ))}
        </dl>
        <p className="mt-6 text-sm text-muted text-center">
          Still deciding?{' '}
          <a href={BRAND.demoBookingUrl} target="_blank" rel="noopener noreferrer" className="underline">
            Book a 15-min demo
          </a>{' '}
          and we&rsquo;ll show you a live booking.
        </p>
      </section>
    </div>
  );
}

function MarkIcon({ mark }: { mark: Mark }): JSX.Element {
  if (mark === 'yes') {
    return (
      <span className="text-accent font-bold" aria-label="Included">
        ✓
      </span>
    );
  }
  if (mark === 'partial') {
    return (
      <span className="text-muted" aria-label="Partial or varies">
        ◐
      </span>
    );
  }
  return (
    <span className="text-slate-300 dark:text-slate-600" aria-label="Not a documented feature">
      —
    </span>
  );
}
