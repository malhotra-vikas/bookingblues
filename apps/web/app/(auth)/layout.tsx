import Link from 'next/link';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="px-6 py-4 border-b">
        <Link href="/" className="font-semibold no-underline">
          BookingBlues
        </Link>
      </header>
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </main>
  );
}
