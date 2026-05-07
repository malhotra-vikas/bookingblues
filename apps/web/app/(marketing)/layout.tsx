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
      <footer className="px-6 py-6 border-t text-xs text-muted">
        © {new Date().getFullYear()} BookingBlues
      </footer>
    </div>
  );
}
