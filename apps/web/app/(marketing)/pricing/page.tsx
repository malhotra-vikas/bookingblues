import type { Metadata } from 'next';
import Link from 'next/link';

import { FoundingPromoBanner } from '../../../components/FoundingPromoBanner';
import { BRAND, TRIAL_COPY } from '../../../lib/brand';
import { getPlanPrices, getPromo } from '../../../lib/plans';
import { PricingTiers } from './PricingTiers';

export const metadata: Metadata = {
  title: 'Pricing — KeeprSteady AI Dispatcher',
  description:
    'Solo, Crew, and Fleet plans. No long-term contracts. Try free for 7 days.',
  alternates: { canonical: '/pricing' },
};

export default async function PricingPage(): Promise<JSX.Element> {
  const [prices, promo] = await Promise.all([getPlanPrices(), getPromo()]);
  return (
    <div className="px-6 py-12 max-w-5xl mx-auto">
      <FoundingPromoBanner promo={promo} className="mb-8 max-w-2xl mx-auto" />
      <header className="text-center max-w-2xl mx-auto">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-ink dark:text-slate-100">
          Never lose another job to a missed call.
        </h1>
        <p className="mt-3 text-muted">
          Not an answering service. When you can&rsquo;t pick up, KeeprSteady texts the caller back
          in seconds, qualifies the job, books it on your calendar, and collects the deposit —
          before they call the next guy.
        </p>
        <p className="mt-2 text-sm text-muted">
          {TRIAL_COPY.durationLabel}, no charge until day 8.{' '}
          <a href={BRAND.demoBookingUrl} target="_blank" rel="noopener noreferrer" className="underline">
            Book a 15-min demo →
          </a>
        </p>
      </header>

      {/* ── ROI framing: one job pays for the month ─────────────────────── */}
      <section className="mt-10 rounded-2xl border border-accent/20 bg-accent-soft/60 dark:bg-slate-900 dark:border-slate-800 p-6 max-w-3xl mx-auto">
        <p className="text-xs font-semibold tracking-[0.16em] uppercase text-accent mb-2">
          One recovered job pays for the month
        </p>
        <p className="text-[15px] text-ink dark:text-slate-100 leading-relaxed">
          The average missed call in the trades is a <strong>$300–$1,500 job</strong>. Miss three a
          week and you&rsquo;re handing competitors five figures a year. KeeprSteady turns those
          missed calls into booked appointments with a deposit already down — so the job actually
          shows up.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-950/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Without KeeprSteady
            </p>
            <ul className="mt-2 space-y-1.5 text-sm text-muted">
              <li>Call goes to voicemail</li>
              <li>Homeowner calls the next contractor</li>
              <li>No-show risk on every booking</li>
              <li>You never find out you lost the job</li>
            </ul>
          </div>
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
              With KeeprSteady
            </p>
            <ul className="mt-2 space-y-1.5 text-sm text-ink dark:text-slate-100">
              <li>Caller gets a text back in seconds</li>
              <li>Job qualified &amp; booked on your calendar</li>
              <li>Deposit collected up front</li>
              <li>You wake up to a confirmed appointment</li>
            </ul>
          </div>
        </div>
      </section>

      <PricingTiers prices={prices} promo={promo} />

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
          Solo: +15%. Crew: +12%. Fleet: +10% — the bigger you grow, the smaller our cut. Our
          incentive is exactly the same as yours: book more jobs.
        </p>
      </section>

      {/* ── Trial guarantee ─────────────────────────────────────────────── */}
      <section className="mt-6 rounded-xl border border-slate-200 bg-slate-50 dark:bg-slate-900 dark:border-slate-800 p-6 max-w-3xl mx-auto text-center">
        <p className="text-lg font-semibold text-ink dark:text-slate-100">
          Try it free for 7 days — no card charged until day 8.
        </p>
        <p className="mt-2 text-[15px] text-muted leading-relaxed">
          See real missed calls turn into booked jobs before you pay a cent. If it&rsquo;s not
          recovering work for you, cancel in 2 clicks from Settings — no email, no phone call.
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
    q: 'How is this different from an answering service?',
    a: 'An answering service takes a message and hands you a callback list. KeeprSteady books the job and collects the deposit for you — you wake up to confirmed appointments on your calendar, not a stack of people to chase. It qualifies the lead first, so out-of-scope and tire-kicker calls never make it onto your schedule.',
  },
  {
    q: 'I already call people back — why do I need this?',
    a: 'By the time you are out from under the sink, the homeowner has already called the next contractor. Speed wins the job. KeeprSteady replies within seconds, 24/7, while you keep working — and it does not just answer, it books the appointment and takes the deposit.',
  },
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
    a: 'On Solo, deposit is off by default — enable it anytime in settings. On Crew, deposit is on by default but can be disabled in onboarding with one toggle (your dashboard will show estimated revenue forfeited if you turn it off). On Fleet, deposit is mandatory and cannot be disabled. You always set your own deposit amount and receive 100% of it. KeeprSteady adds a platform fee on top (15% Solo, 12% Crew, 10% Fleet — the fee drops as you scale) charged to the customer via a single Stripe transaction — we never touch your funds.',
  },
];
