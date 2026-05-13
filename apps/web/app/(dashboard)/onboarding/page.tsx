import Link from 'next/link';

import { Wizard } from '../../../components/onboarding/Wizard';
import { ApiError, apiAsUser } from '../../../lib/api';

interface Operator {
  id: string;
  business_name: string;
  category: string | null;
  twilio_number_e164: string | null;
  google_calendar_id: string | null;
  stripe_connect_account_id: string | null;
  stripe_connect_charges_enabled: boolean;
  stripe_connect_payouts_enabled: boolean;
  booking_fee_enabled: boolean;
  booking_fee_cents: number | null;
  service_zip_codes: string[];
  service_radius_zones: Array<{ center_zip: string; radius_miles: number }>;
  subscription_status: string | null;
  onboarding_completed_at: string | null;
}

export default async function OnboardingPage(): Promise<JSX.Element> {
  let operator: Operator | null = null;
  let notFound = false;
  try {
    operator = await apiAsUser<Operator>('/v1/operators/me');
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound = true;
    else throw err;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold dark:text-slate-100">Onboarding</h1>
        <p className="text-sm text-muted dark:text-slate-400 mt-1">
          Six steps to start booking missed calls. You can come back to this page anytime.
        </p>
      </header>

      {notFound ? (
        <p className="text-sm text-muted dark:text-slate-400">
          We couldn&apos;t find your operator profile yet. Start with the subscription step below — it
          will create your profile automatically.
        </p>
      ) : null}

      <Wizard initial={operator} />

      <p className="text-sm text-muted dark:text-slate-400">
        Done?{' '}
        <Link href="/dashboard" className="text-accent dark:text-blue-400">
          Go to your dashboard
        </Link>
        .
      </p>
    </div>
  );
}
