import type { Metadata } from 'next';

import { BRAND } from '../../../../lib/brand';

import { OptInForm } from './OptInForm';

export const metadata: Metadata = {
  title: 'Get scheduled by text — KeeprSteady',
  description:
    'Opt in to receive a text from KeeprSteady to schedule your home-service appointment. Consumer-initiated, one-to-one, conversational. Reply STOP to opt out anytime.',
  alternates: { canonical: '/messaging/opt-in' },
};

/**
 * Public SMS opt-in form — the consent-collection URL cited in the A2P 10DLC
 * campaign submission. Renders the full CTIA disclosure inline and captures an
 * explicit, unchecked-by-default consent via <OptInForm/>.
 */
export default function OptInPage(): JSX.Element {
  return (
    <div className="px-6 py-12 max-w-xl mx-auto">
      <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-ink dark:text-slate-100">
        Get scheduled by text
      </h1>
      <p className="mt-3 text-muted">
        Leave your number and {BRAND.name} will text you to help schedule your home-service
        appointment. These are one-to-one, conversational messages — not marketing. You can reply{' '}
        <strong>STOP</strong> to opt out at any time.
      </p>

      <div className="mt-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
        <OptInForm />
      </div>

      <p className="mt-6 text-xs text-muted">
        See our{' '}
        <a href="/messaging" className="underline">
          SMS Messaging Program
        </a>{' '}
        for full details on how and why we text, message frequency, and how to get HELP or STOP.
      </p>
    </div>
  );
}
