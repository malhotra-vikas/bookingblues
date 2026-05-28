import Link from 'next/link';

import { Logo } from './Logo';
import { SignOutButton } from './SignOutButton';
import { ThemeToggle } from './ThemeToggle';

export function Nav({
  activeUser,
  isAdmin = false,
}: {
  activeUser: { email: string | null };
  isAdmin?: boolean;
}): JSX.Element {
  return (
    <header className="px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-paper dark:bg-slate-900 flex items-center gap-6">
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
        <ThemeToggle />
        <SignOutButton />
      </div>
    </header>
  );
}
