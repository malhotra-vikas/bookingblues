import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { AuthForm } from '../../../components/AuthForm';
import { BRAND } from '../../../lib/brand';

export const metadata: Metadata = {
  title: 'Sign In — KeeprSteady',
  description: 'Sign in to your KeeprSteady dashboard.',
  robots: { index: false, follow: true },
  alternates: { canonical: '/login' },
};

export default function LoginPage(): JSX.Element {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink dark:text-slate-100 mb-1">
        Welcome back
      </h1>
      <p className="text-sm text-muted mb-6">Sign in to your {BRAND.name} account.</p>
      <Suspense fallback={<AuthFormSkeleton />}>
        <AuthForm mode="login" />
      </Suspense>
      <p className="mt-6 text-sm text-muted text-center">
        New here?{' '}
        <Link href="/signup" className="text-accent font-medium">
          Create an account
        </Link>
      </p>
    </div>
  );
}

function AuthFormSkeleton(): JSX.Element {
  return (
    <div className="space-y-4 animate-pulse" aria-hidden="true">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i}>
          <div className="h-3.5 w-24 bg-slate-200 dark:bg-slate-800 rounded mb-2" />
          <div className="h-10 w-full bg-slate-100 dark:bg-slate-800/60 rounded-md border border-slate-200 dark:border-slate-700" />
        </div>
      ))}
      <div className="h-11 w-full bg-slate-200 dark:bg-slate-800 rounded-md" />
    </div>
  );
}
