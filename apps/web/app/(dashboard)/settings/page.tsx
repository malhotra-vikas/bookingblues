import Link from 'next/link';

import { SettingsPanel } from '../../../components/SettingsPanel';
import { ApiError, apiAsUser } from '../../../lib/api';

interface Operator {
  id: string;
  business_name: string;
  category: string | null;
  timezone: string;
  personal_phone_e164: string | null;
  twilio_number_e164: string | null;
  google_calendar_id: string | null;
  booking_fee_enabled: boolean;
  booking_fee_cents: number | null;
  subscription_status: string | null;
  trial_ends_at: string | null;
  stripe_connect_account_id: string | null;
  stripe_connect_charges_enabled: boolean;
  stripe_connect_payouts_enabled: boolean;
}

export default async function SettingsPage(): Promise<JSX.Element> {
  let operator: Operator | null = null;
  let notFound = false;
  try {
    operator = await apiAsUser<Operator>('/v1/operators/me');
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound = true;
    else throw err;
  }

  if (notFound || !operator) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted">
          Finish onboarding to access settings.{' '}
          <Link href="/onboarding" className="text-accent">
            Go to onboarding
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Settings</h1>
      </header>
      <SettingsPanel operator={operator} />
    </div>
  );
}
