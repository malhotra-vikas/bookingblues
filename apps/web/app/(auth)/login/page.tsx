import Link from 'next/link';
import { Suspense } from 'react';

import { AuthForm } from '../../../components/AuthForm';

export default function LoginPage(): JSX.Element {
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Sign in</h1>
      {/* AuthForm reads ?next= via useSearchParams; Next 16 requires it
          inside a Suspense boundary so the shell can statically prerender. */}
      <Suspense fallback={<div className="text-sm text-muted">Loading…</div>}>
        <AuthForm mode="login" />
      </Suspense>
      <p className="mt-4 text-sm text-muted">
        New here?{' '}
        <Link href="/signup" className="text-accent">
          Create an account
        </Link>
        .
      </p>
    </div>
  );
}
