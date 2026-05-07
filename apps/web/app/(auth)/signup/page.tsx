import Link from 'next/link';

import { AuthForm } from '../../../components/AuthForm';

export default function SignupPage(): JSX.Element {
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Create your BookingBlues account</h1>
      <AuthForm mode="signup" />
      <p className="mt-4 text-sm text-muted">
        Already have one?{' '}
        <Link href="/login" className="text-accent">
          Sign in
        </Link>
        .
      </p>
    </div>
  );
}
