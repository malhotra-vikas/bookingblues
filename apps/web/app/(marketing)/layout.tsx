import Link from 'next/link';
import type { ReactNode } from 'react';

import { ThemeToggle } from '../../components/ThemeToggle';

export default function MarketingLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-6">
        <Link href="/" className="font-semibold no-underline text-ink dark:text-slate-100">
          BookingBlues
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/pricing" className="no-underline">
            Pricing
          </Link>
          <Link href="/faq" className="no-underline">
            FAQ
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <ThemeToggle />
          <Link href="/login" className="no-underline">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-md bg-accent px-3 py-1.5 text-white no-underline"
          >
            Get started
          </Link>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-slate-200 dark:border-slate-800 mt-12">
        <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-muted">
            <span className="font-semibold text-ink dark:text-slate-100">BookingBlues</span>
            <span>·</span>
            <span>© {new Date().getFullYear()}</span>
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/pricing" className="no-underline text-muted hover:text-ink dark:hover:text-slate-100">Pricing</Link>
            <Link href="/faq" className="no-underline text-muted hover:text-ink dark:hover:text-slate-100">FAQ</Link>
            <Link href="/login" className="no-underline text-muted hover:text-ink dark:hover:text-slate-100">Sign in</Link>
            <a href="mailto:hello@bookingblues.com" className="no-underline text-muted hover:text-ink dark:hover:text-slate-100">Contact</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
