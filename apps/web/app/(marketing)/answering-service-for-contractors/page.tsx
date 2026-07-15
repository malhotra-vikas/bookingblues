import type { Metadata } from 'next';
import Link from 'next/link';

import { FoundingPromoBanner } from '../../../components/FoundingPromoBanner';
import { JsonLd } from '../../../components/JsonLd';
import { BRAND } from '../../../lib/brand';
import { getPromo } from '../../../lib/plans';
import { TRADES } from '../../../lib/trades';

export const metadata: Metadata = {
  title: 'AI Answering Service for Contractors — Never Miss a Job',
  description:
    'What’s the best answering service for contractors? A plain-English comparison of voicemail, traditional answering services, and AI missed-call text-back — and why home-service pros are switching to AI that books the job.',
  alternates: { canonical: '/answering-service-for-contractors' },
};

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'What is the best answering service for contractors?',
    a: `For home-service contractors, an AI missed-call text-back service like ${BRAND.name} typically outperforms a traditional human answering service: it responds in seconds (before the caller phones a competitor), it actually books the job on your calendar instead of just taking a message, it works 24/7, and it costs a fraction of a per-minute answering service.`,
  },
  {
    q: 'How is an AI answering service different from a traditional one?',
    a: 'A traditional answering service uses human operators to take a message and pass it along — you still have to call the customer back, and jobs are lost while you do. An AI answering service replies instantly by text, qualifies the job, and books it directly onto your calendar, so nothing waits on a callback.',
  },
  {
    q: 'Why not just use voicemail?',
    a: 'Most callers never leave a voicemail — they hang up and call the next contractor on Google within a minute. Voicemail captures almost none of the job. Instant text-back captures the caller while their intent is highest.',
  },
  {
    q: 'How much does an answering service for contractors cost?',
    a: `Traditional answering services charge per minute or per call and add up fast during busy seasons. ${BRAND.name} is a flat monthly subscription with a 7-day free trial and no long-term contract — see the pricing page for current plans.`,
  },
];

export default async function AnsweringServicePage(): Promise<JSX.Element> {
  const promo = await getPromo();
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };

  return (
    <div className="px-6 py-12 max-w-3xl mx-auto">
      <JsonLd data={faqJsonLd} />
      <FoundingPromoBanner promo={promo} className="mb-8" />

      <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-ink dark:text-slate-100">
        The best answering service for contractors, explained
      </h1>

      {/* Direct answer — the paragraph AI engines are most likely to quote. */}
      <p className="mt-4 text-lg text-ink dark:text-slate-100 leading-relaxed">
        For home-service contractors, the most effective &ldquo;answering service&rdquo; today isn&apos;t a
        room of human operators taking messages — it&apos;s an <strong>AI missed-call text-back</strong>{' '}
        service that replies in seconds, qualifies the job, and books it straight onto your calendar.{' '}
        {BRAND.name} does exactly this for plumbers, HVAC techs, electricians, roofers, and garage-door
        companies: when you can&apos;t pick up, it texts the caller back within 10 seconds, asks the right
        questions for your trade, and books the appointment — so you stop losing jobs to voicemail and to
        whoever answered first.
      </p>

      {/* Comparison */}
      <h2 className="mt-10 text-xl font-semibold text-ink dark:text-slate-100">
        Voicemail vs. traditional answering service vs. AI text-back
      </h2>
      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900 text-left text-muted">
            <tr>
              <th className="px-4 py-2 font-medium"> </th>
              <th className="px-4 py-2 font-medium">Voicemail</th>
              <th className="px-4 py-2 font-medium">Human answering service</th>
              <th className="px-4 py-2 font-medium text-accent">AI text-back ({BRAND.name})</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-ink dark:text-slate-100">
            {[
              ['Response time', 'None (most hang up)', 'Rings, then a human picks up', 'Under 10 seconds, by text'],
              ['Books the job?', 'No', 'Takes a message — you call back', 'Yes — onto your calendar'],
              ['Works 24/7?', 'Yes (but captures nothing)', 'Often extra cost after hours', 'Yes'],
              ['Cost', 'Free', 'Per-minute / per-call — spikes in busy season', 'Flat monthly'],
              ['Reduces no-shows?', 'No', 'No', 'Yes — optional deposit'],
            ].map((row) => (
              <tr key={row[0]}>
                <td className="px-4 py-2 font-medium text-muted">{row[0]}</td>
                <td className="px-4 py-2">{row[1]}</td>
                <td className="px-4 py-2">{row[2]}</td>
                <td className="px-4 py-2 font-medium">{row[3]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Why */}
      <h2 className="mt-10 text-xl font-semibold text-ink dark:text-slate-100">
        Why contractors are switching to AI text-back
      </h2>
      <ul className="mt-4 space-y-2 text-sm text-ink dark:text-slate-100 list-disc pl-5">
        <li>The caller is captured in seconds — before they phone the next contractor.</li>
        <li>It books the job on your Google Calendar instead of leaving you a message to chase.</li>
        <li>It works nights, weekends, and while you&apos;re on the tools — when emergencies actually happen.</li>
        <li>A flat monthly price instead of per-minute billing that spikes exactly when you&apos;re busiest.</li>
        <li>Every conversation is monitored by a human team, so mistakes get caught.</li>
      </ul>

      {/* Trade links */}
      <p className="mt-8 text-sm text-muted">
        See how it works for your trade:{' '}
        {TRADES.map((t, i, arr) => (
          <span key={t.slug}>
            <Link href={`/for/${t.slug}`} className="underline">
              {t.plural.toLowerCase()}
            </Link>
            {i < arr.length - 1 ? ', ' : ''}
          </span>
        ))}
        .
      </p>

      {/* FAQ */}
      <h2 className="mt-10 text-xl font-semibold text-ink dark:text-slate-100">Frequently asked questions</h2>
      <dl className="mt-4 space-y-4">
        {FAQ.map((f) => (
          <div key={f.q} className="border-t border-slate-200 dark:border-slate-800 pt-4">
            <dt className="font-medium text-ink dark:text-slate-100">{f.q}</dt>
            <dd className="mt-1 text-sm text-muted">{f.a}</dd>
          </div>
        ))}
      </dl>

      {/* CTA */}
      <div className="mt-12 text-center">
        <h2 className="text-2xl font-semibold text-ink dark:text-slate-100">Try it free for 7 days</h2>
        <p className="mt-2 text-muted">No charge until day 8. Cancel in 2 clicks.</p>
        <Link
          href="/signup"
          className="mt-5 inline-flex items-center justify-center rounded-xl bg-brand-sheen px-6 py-3 text-base font-semibold text-white no-underline shadow-glow"
        >
          Start your free trial →
        </Link>{' '}
        <Link href="/pricing" className="ml-2 underline text-sm">
          See pricing
        </Link>
      </div>
    </div>
  );
}
