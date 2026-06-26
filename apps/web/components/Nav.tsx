import Link from 'next/link';

import { Logo } from './Logo';
import { SignOutButton } from './SignOutButton';

export function Nav({
  activeUser,
  isAdmin = false,
}: {
  activeUser: { email: string | null };
  isAdmin?: boolean;
}): JSX.Element {
  return (
    <header className="sticky top-0 z-30 px-6 py-3 border-b border-slate-200/70 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 backdrop-blur flex items-center gap-6">
      <Link href="/dashboard" className="no-underline" aria-label="KeeprSteady dashboard">
        <Logo />
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
        {isAdmin && (
          <Link href="/admin" className="no-underline font-semibold text-red-700 dark:text-red-400">
            Admin
          </Link>
        )}
      </nav>
      <div className="ml-auto flex items-center gap-3 text-sm text-muted">
        <span className="hidden sm:inline dark:text-slate-400">{activeUser.email}</span>
        <SignOutButton />
      </div>
    </header>
  );
}
