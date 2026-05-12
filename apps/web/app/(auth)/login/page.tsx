import Link from 'next/link';
import { Suspense } from 'react';

import { AuthForm } from '../../../components/AuthForm';

export default function LoginPage(): JSX.Element {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink mb-1">Welcome back</h1>
      <p className="text-sm text-muted mb-6">Sign in to your BookingBlues account.</p>
      <Suspense fallback={<div className="text-sm text-muted">Loading…</div>}>
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
