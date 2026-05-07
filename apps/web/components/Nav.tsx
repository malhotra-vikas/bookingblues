import Link from 'next/link';

import { SignOutButton } from './SignOutButton';

export function Nav({ activeUser }: { activeUser: { email: string | null } }): JSX.Element {
  return (
    <header className="px-6 py-3 border-b flex items-center gap-6">
      <Link href="/dashboard" className="font-semibold no-underline text-ink">
        BookingBlues
      </Link>
      <nav className="flex items-center gap-4 text-sm">
        <Link href="/dashboard" className="no-underline">
          Dashboard
        </Link>
        <Link href="/onboarding" className="no-underline">
          Onboarding
        </Link>
        <Link href="/settings" className="no-underline">
          Settings
        </Link>
      </nav>
      <div className="ml-auto flex items-center gap-4 text-sm text-muted">
        <span className="hidden sm:inline">{activeUser.email}</span>
        <SignOutButton />
      </div>
    </header>
  );
}
