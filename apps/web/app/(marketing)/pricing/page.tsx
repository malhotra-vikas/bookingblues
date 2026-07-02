import type { Metadata } from 'next';
import Link from 'next/link';

import { BRAND, TRIAL_COPY } from '../../../lib/brand';
import { getPlanPrices } from '../../../lib/plans';
import { PricingTiers } from './PricingTiers';

export const metadata: Metadata = {
  title: 'Pricing — KeeprSteady AI Dispatcher',
  description:
    'Solo, Crew, and Fleet plans. No long-term contracts. Try free for 7 days.',
  alternates: { canonical: '/pricing' },
};

export default async function PricingPage(): Promise<JSX.Element> {
  const prices = await getPlanPrices();
  return (
    <div className="px-6 py-12 max-w-5xl mx-auto">
      <header className="text-center max-w-2xl mx-auto">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-ink">Pricing</h1>
        <p className="mt-3 text-muted">
          One subscription. Three sizes. {TRIAL_COPY.durationLabel}, no charge until day 8.
        </p>
        <p className="mt-2 text-sm text-muted">
          Have questions? <a href={BRAND.demoBookingUrl} target="_blank" rel="noopener noreferrer" className="underline">Book a 15-min demo →</a>
        </p>
      </header>

      <PricingTiers prices={prices} />

      {/* ── HITL trust signal ───────────────────────────────────────────── */}
      <section className="mt-12 rounded-xl border border-slate-200 bg-slate-50 dark:bg-slate-900 dark:border-slate-800 p-6 max-w-3xl mx-auto">
        <p className="text-xs font-semibold tracking-[0.16em] uppercase text-accent mb-2">
          Human-in-the-loop monitoring
        </p>
        <p className="text-[15px] text-ink dark:text-slate-100 leading-relaxed">
          Every AI conversation is monitored by our team — not just logged. If the AI makes a
          misstep, a human steps in and corrects it in real time. You get automation speed with
          the accuracy of a trained dispatcher.
        </p>
      </section>

      {/* ── 10% alignment selling point ─────────────────────────────────── */}
      <section className="mt-6 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 p-6 max-w-3xl mx-auto">
        <p className="text-xs font-semibold tracking-[0.16em] uppercase text-emerald-700 dark:text-emerald-300 mb-2">
          Aligned incentives
        </p>
        <p className="text-[15px] text-ink dark:text-slate-100 leading-relaxed">
          <strong>You set the deposit. We add our fee on top — charged to the customer, not
          taken from you.</strong>{' '}
          Solo: +10%. Crew: +15%. Fleet: +20%. Our incentive is exactly the same as yours: book
          more jobs.
        </p>
      </section>

      <p className="text-center mt-8 text-sm text-muted">
        No long-term contract · {TRIAL_COPY.chargeReassurance.toLowerCase().replace(/^./, (c) => c.toUpperCase())}
      </p>

      {/* ── Inline FAQ ──────────────────────────────────────────────────── */}
      <section className="mt-16 max-w-2xl mx-auto">
        <h2 className="text-xl font-semibold text-ink dark:text-slate-100">Common questions</h2>
        <dl className="mt-6 space-y-4">
          {INLINE_FAQ.map((item) => (
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
          More questions? See the{' '}
          <Link href="/faq" className="underline">
            full FAQ
          </Link>{' '}
          or{' '}
          <a href={BRAND.demoBookingUrl} target="_blank" rel="noopener noreferrer" className="underline">
            book a 15-min demo
          </a>
          .
        </p>
      </section>
    </div>
  );
}

const INLINE_FAQ: ReadonlyArray<{ q: string; a: string }> = [
  {
    q: 'Can I cancel anytime?',
    a: 'Yes — in 2 clicks from Settings → Billing. No email, no phone call, no minimum term. Your dedicated number is released after a 7-day grace period in case you change your mind.',
  },
  {
    q: 'What happens after my free trial?',
    a: 'Your card is charged on day 8 at your plan rate. You will get an email reminder on day 6. Cancel before day 8 and you will not be charged.',
  },
  {
    q: 'What counts as a "conversation"?',
    a: 'One complete inbound lead interaction with the AI — typically 8–15 messages back and forth, from the first text after a missed call until the bot books, declines, or hands off. We count conversations, not individual SMS segments.',
  },
  {
    q: 'Is deposit collection required?',
    a: 'On Solo, deposit is off by default — enable it anytime in settings. On Crew, deposit is on by default but can be disabled in onboarding with one toggle (your dashboard will show estimated revenue forfeited if you turn it off). On Fleet, deposit is mandatory and cannot be disabled. You always set your own deposit amount and receive 100% of it. KeeprSteady adds a platform fee on top (10% Solo, 15% Crew, 20% Fleet) charged to the customer via a single Stripe transaction — we never touch your funds.',
  },
];
