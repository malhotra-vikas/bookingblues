import type { Metadata } from 'next';
import Link from 'next/link';

import { BRAND } from '../../../lib/brand';

export const metadata: Metadata = {
  title: 'Careers — KeeprSteady',
  description:
    'Join KeeprSteady. We are hiring sales reps to bring AI call recovery to home-service businesses. Uncapped commission, warm product, real impact.',
  alternates: { canonical: '/careers' },
};

const APPLY_HREF = `mailto:${BRAND.careersEmail}?subject=${encodeURIComponent('Sales rep application — KeeprSteady')}`;

export default function CareersPage(): JSX.Element {
  return (
    <div className="px-6 py-12 max-w-3xl mx-auto">
      <header className="text-center max-w-2xl mx-auto">
        <p className="text-xs font-semibold tracking-[0.16em] uppercase text-accent">Careers</p>
        <h1 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight text-ink dark:text-slate-100">
          Help contractors never miss a job again
        </h1>
        <p className="mt-3 text-muted">
          {BRAND.name} turns missed calls into booked appointments for plumbers, HVAC, roofers, and
          electricians. We&apos;re growing our sales team — if you can sell a product that pays for
          itself, we want to talk.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <a
            href={APPLY_HREF}
            className="inline-flex items-center justify-center rounded-xl bg-brand-sheen px-5 py-3 text-base font-semibold text-white no-underline shadow-glow transition-all duration-300 hover:-translate-y-0.5"
          >
            Apply now
          </a>
          <a
            href={BRAND.demoBookingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 dark:border-slate-700 px-5 py-3 text-base font-semibold text-ink dark:text-slate-100 no-underline transition-all duration-300 hover:border-accent/40 hover:bg-accent-soft"
          >
            See the product
          </a>
        </div>
      </header>

      {/* ── Open role: Sales Representative ─────────────────────────────── */}
      <section className="mt-14 rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur shadow-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-ink dark:text-slate-100">Sales Representative</h2>
          <span className="rounded-full bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold px-2.5 py-1">
            Open · Remote · Commission
          </span>
        </div>
        <p className="mt-3 text-sm text-muted leading-relaxed">
          Own the full cycle: prospect home-service businesses, run a quick demo, and get them
          booking jobs with their new AI dispatcher. You bring the lead in and it&apos;s yours —
          assigned to you automatically — with a dashboard to track every account you sign.
        </p>
        <ul className="mt-4 space-y-2 text-sm text-ink dark:text-slate-100">
          <Bullet>Uncapped commission on a product contractors keep because it books real jobs</Bullet>
          <Bullet>Warm, easy-to-explain value: never miss a call, never lose a job to a competitor</Bullet>
          <Bullet>Tools that do the busywork — add a client in seconds, leads auto-assigned to you</Bullet>
          <Bullet>Remote, flexible hours; you run your own book of business</Bullet>
        </ul>
        <div className="mt-6">
          <a
            href={APPLY_HREF}
            className="inline-flex items-center justify-center rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white no-underline"
          >
            Apply for this role →
          </a>
        </div>
      </section>

      {/* ── Don't see your role ────────────────────────────────────────── */}
      <section className="mt-8 text-center">
        <p className="text-sm text-muted">
          Don&apos;t see a role that fits? We&apos;re always glad to meet great people. Email{' '}
          <a href={`mailto:${BRAND.careersEmail}`} className="underline">
            {BRAND.careersEmail}
          </a>
          .
        </p>
        <p className="mt-4 text-xs text-muted">
          Questions about the product first?{' '}
          <Link href="/faq" className="underline">
            Read the FAQ
          </Link>{' '}
          or{' '}
          <Link href="/contact" className="underline">
            book a demo
          </Link>
          .
        </p>
      </section>
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
