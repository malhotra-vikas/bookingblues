import Link from 'next/link';

import { AuthForm } from '../../../components/AuthForm';

export default function LoginPage(): JSX.Element {
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Sign in</h1>
      <AuthForm mode="login" />
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
