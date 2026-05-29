import Link from 'next/link';
import type { ReactNode } from 'react';

import { LegalFooter } from '../../components/LegalFooter';
import { Logo } from '../../components/Logo';
import { ThemeToggle } from '../../components/ThemeToggle';
import { BRAND } from '../../lib/brand';

export default function MarketingLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-6">
        <Link href="/" className="no-underline" aria-label={`${BRAND.name} home`}>
          <Logo />
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/pricing" className="no-underline hover:text-accent">
            Pricing
          </Link>
          <Link href="/faq" className="no-underline hover:text-accent">
            FAQ
          </Link>
          <Link href="/contact" className="no-underline hover:text-accent">
            Contact
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <ThemeToggle />
          <a
            href={BRAND.demoBookingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="no-underline hidden sm:inline hover:text-accent"
          >
            Book a demo
          </a>
          <Link href="/login" className="no-underline hover:text-accent">
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
        <div className="max-w-5xl mx-auto px-6 py-8">
          <LegalFooter variant="marketing" />
        </div>
      </footer>
    </div>
  );
}
