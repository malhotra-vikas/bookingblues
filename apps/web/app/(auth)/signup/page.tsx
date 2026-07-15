import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { AuthForm } from '../../../components/AuthForm';
import { FoundingPromoBanner } from '../../../components/FoundingPromoBanner';
import { TRIAL_COPY } from '../../../lib/brand';
import { getPromo } from '../../../lib/plans';

export const metadata: Metadata = {
  title: 'Start Free Trial — KeeprSteady',
  description: 'Create your KeeprSteady account. 7-day free trial, no charge until day 8.',
  robots: { index: false, follow: true },
  alternates: { canonical: '/signup' },
};

export default async function SignupPage(): Promise<JSX.Element> {
  const promo = await getPromo();
  return (
    <div>
      <FoundingPromoBanner promo={promo} className="mb-6" />
      <h1 className="text-2xl font-semibold tracking-tight text-ink dark:text-slate-100 mb-1">
        Start your {TRIAL_COPY.durationLabel}
      </h1>
      <p className="text-sm text-muted mb-6">{TRIAL_COPY.chargeReassurance}</p>
      <Suspense fallback={<AuthFormSkeleton mode="signup" />}>
        <AuthForm mode="signup" />
      </Suspense>
      <p className="mt-6 text-sm text-muted text-center">
        Already have an account?{' '}
        <Link href="/login" className="text-accent font-medium">
          Sign in
        </Link>
      </p>
    </div>
  );
}

function AuthFormSkeleton({ mode }: { mode: 'signup' | 'login' }): JSX.Element {
  const fieldCount = mode === 'signup' ? 4 : 2;
  return (
    <div className="space-y-4 animate-pulse" aria-hidden="true">
      {Array.from({ length: fieldCount }).map((_, i) => (
        <div key={i}>
          <div className="h-3.5 w-24 bg-slate-200 dark:bg-slate-800 rounded mb-2" />
          <div className="h-10 w-full bg-slate-100 dark:bg-slate-800/60 rounded-md border border-slate-200 dark:border-slate-700" />
        </div>
      ))}
      {mode === 'signup' ? (
        <div className="h-4 w-full bg-slate-100 dark:bg-slate-800/60 rounded" />
      ) : null}
      <div className="h-11 w-full bg-slate-200 dark:bg-slate-800 rounded-md" />
    </div>
  );
}
