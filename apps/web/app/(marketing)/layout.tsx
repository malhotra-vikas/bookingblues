import Link from 'next/link';
import type { ReactNode } from 'react';

export default function MarketingLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-6 py-4 border-b flex items-center gap-6">
        <Link href="/" className="font-semibold no-underline text-ink">
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
      <footer className="border-t mt-12">
        <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-muted">
            <span className="font-semibold text-ink">BookingBlues</span>
            <span>·</span>
            <span>© {new Date().getFullYear()}</span>
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/pricing" className="no-underline text-muted hover:text-ink">Pricing</Link>
            <Link href="/faq" className="no-underline text-muted hover:text-ink">FAQ</Link>
            <Link href="/login" className="no-underline text-muted hover:text-ink">Sign in</Link>
            <a href="mailto:hello@bookingblues.com" className="no-underline text-muted hover:text-ink">Contact</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
