import Link from 'next/link';
import type { ReactNode } from 'react';

import { LegalFooter } from '../../components/LegalFooter';
import { Logo } from '../../components/Logo';
import { BRAND, TRIAL_COPY } from '../../lib/brand';

export default function AuthLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <main className="min-h-screen flex flex-col bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <header className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="max-w-5xl mx-auto flex items-center gap-6">
          <Link href="/" className="no-underline" aria-label={`${BRAND.name} home`}>
            <Logo />
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/pricing" className="no-underline text-muted hover:text-accent">
              Pricing
            </Link>
            <Link href="/faq" className="no-underline text-muted hover:text-accent">
              FAQ
            </Link>
            <Link href="/contact" className="no-underline text-muted hover:text-accent">
              Contact
            </Link>
          </nav>
        </div>
      </header>

      <div className="flex-1 px-6 py-12">
        <div className="max-w-5xl mx-auto grid lg:grid-cols-[1fr_440px] gap-12 items-center">
          {/* Brand pitch — desktop only */}
          <aside className="hidden lg:block">
            <p className="text-xs font-semibold tracking-[0.18em] uppercase text-accent dark:text-accent-light mb-4">
              AI lead recovery for home service pros
            </p>
            <h2 className="text-3xl font-semibold leading-tight text-ink dark:text-slate-100 tracking-tight mb-4">
              Never miss another job.
            </h2>
            <p className="text-base text-muted dark:text-slate-400 leading-relaxed max-w-md">
              AI books your missed calls by text while you&apos;re on the job. Burst pipe at
              11pm, AC out at 95°, storm damage on a roof — the caller gets a text in 10 seconds,
              you get an SMS alert, and the appointment lands on your calendar before they call
              the next contractor.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-muted dark:text-slate-400">
              <Bullet>Responds in under 10 seconds, 24/7</Bullet>
              <Bullet>Trade-specific vetting for plumbers, HVAC, roofers, and electricians</Bullet>
              <Bullet>Emergency-keyword detection alerts you instantly</Bullet>
              <Bullet>Syncs with Google Calendar; Jobber and HCP coming soon</Bullet>
              <Bullet>{TRIAL_COPY.durationLabel} · cancel anytime</Bullet>
            </ul>
          </aside>

          {/* Form card */}
          <section className="w-full max-w-md mx-auto lg:mx-0">
            <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm p-7">
              {children}
            </div>
          </section>
        </div>
      </div>

      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="max-w-5xl mx-auto px-6 py-6">
          <LegalFooter variant="auth" />
        </div>
      </footer>
    </main>
  );
}

function Bullet({ children }: { children: ReactNode }): JSX.Element {
  return (
    <li className="flex items-start gap-2">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-emerald-600 mt-0.5 shrink-0"
        aria-hidden="true"
      >
        <path d="m5 12 5 5L20 7" />
      </svg>
      <span>{children}</span>
    </li>
  );
}
