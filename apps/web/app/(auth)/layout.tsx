import Link from 'next/link';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <main className="min-h-screen flex flex-col bg-gradient-to-b from-slate-50 to-white">
      <header className="px-6 py-4 border-b border-slate-200 bg-white">
        <div className="max-w-5xl mx-auto flex items-center gap-6">
          <Link href="/" className="font-semibold no-underline text-ink">
            BookingBlues
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/pricing" className="no-underline text-muted hover:text-ink">
              Pricing
            </Link>
            <Link href="/faq" className="no-underline text-muted hover:text-ink">
              FAQ
            </Link>
          </nav>
        </div>
      </header>

      <div className="flex-1 px-6 py-12">
        <div className="max-w-5xl mx-auto grid lg:grid-cols-[1fr_440px] gap-12 items-center">
          {/* Brand pitch — desktop only */}
          <aside className="hidden lg:block">
            <p className="text-xs font-semibold tracking-[0.18em] uppercase text-accent mb-4">
              AI lead recovery for the trades
            </p>
            <h2 className="text-3xl font-semibold leading-tight text-ink tracking-tight mb-4">
              The first to answer wins the job.
            </h2>
            <p className="text-base text-muted leading-relaxed max-w-md">
              When a customer hits your voicemail, BookingBlues texts them right back, vets the
              job, and books it on your calendar — all while you&apos;re on the other line.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-muted">
              <Bullet>Responds in under 10 seconds, 24/7</Bullet>
              <Bullet>Syncs with Google Calendar today</Bullet>
              <Bullet>Optional booking deposit via Stripe</Bullet>
              <Bullet>Free for 7 days · cancel anytime</Bullet>
            </ul>
          </aside>

          {/* Form card */}
          <section className="w-full max-w-md mx-auto lg:mx-0">
            <div className="rounded-xl bg-white border border-slate-200 shadow-sm p-7">
              {children}
            </div>
          </section>
        </div>
      </div>

      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>© {new Date().getFullYear()} BookingBlues</span>
          <nav className="flex gap-4">
            <Link href="/pricing" className="no-underline text-muted hover:text-ink">
              Pricing
            </Link>
            <Link href="/faq" className="no-underline text-muted hover:text-ink">
              FAQ
            </Link>
            <a href="mailto:hello@bookingblues.com" className="no-underline text-muted hover:text-ink">
              Contact
            </a>
          </nav>
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
