import Link from 'next/link';

import { CallQrPoster } from '../../../../components/CallQrPoster';
import { ApiError, apiAsUser } from '../../../../lib/api';

interface Operator {
  business_name: string;
  twilio_number_e164: string | null;
}

/** Printable "scan to call us" poster for the signed-in operator (Settings → Call-us QR code). */
export default async function QrPosterPage(): Promise<JSX.Element> {
  let operator: Operator | null = null;
  try {
    operator = await apiAsUser<Operator>('/v1/operators/me');
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 404)) throw err;
  }

  if (!operator?.twilio_number_e164) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold dark:text-slate-100">Call-us poster</h1>
        <p className="text-sm text-muted dark:text-slate-400">
          Your poster is available once your KeeprSteady number is set up.{' '}
          <Link href="/onboarding" className="text-accent dark:text-accent-light">
            Go to onboarding
          </Link>
          .
        </p>
      </div>
    );
  }

  return <CallQrPoster businessName={operator.business_name} twilioNumberE164={operator.twilio_number_e164} />;
}
