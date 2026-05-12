import Link from 'next/link';
import { Suspense } from 'react';

import { AuthForm } from '../../../components/AuthForm';

export default function SignupPage(): JSX.Element {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink mb-1">Start your 7-day trial</h1>
      <p className="text-sm text-muted mb-6">No charge until day 8 — cancel anytime.</p>
      <Suspense fallback={<div className="text-sm text-muted">Loading…</div>}>
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
