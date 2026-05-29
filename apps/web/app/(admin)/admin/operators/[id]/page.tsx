import Link from 'next/link';
import { notFound } from 'next/navigation';

import { OperatorActions } from '../../../../../components/admin/OperatorActions';
import { OperatorTabs } from '../../../../../components/admin/OperatorTabs';
import { apiAsUser } from '../../../../../lib/api';

interface Operator {
  id: string;
  business_name: string;
  category: string | null;
  subscription_status: string | null;
  trial_ends_at: string | null;
  twilio_number_e164: string | null;
  twilio_number_sid: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_connect_account_id: string | null;
  stripe_connect_charges_enabled: boolean;
  stripe_connect_payouts_enabled: boolean;
  google_calendar_id: string | null;
  booking_fee_enabled: boolean;
  booking_fee_cents: number | null;
  timezone: string;
  created_at: string;
  onboarding_completed_at: string | null;
}

interface Dossier {
  operator: Operator;
  user_email: string | null;
  totals: {
    conversations: number;
    appointments_confirmed: number;
    appointments_completed: number;
    fee_revenue_cents: number;
  };
}

export default async function DossierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;
  const dossier = await apiAsUser<Dossier>(`/v1/admin/operators/${id}`).catch(() => null);
  if (!dossier) notFound();

  const op = dossier.operator;

  return (
    <section className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/admin/operators" className="text-xs text-muted dark:text-slate-400 no-underline hover:underline">
            ← Operators
          </Link>
          <h1 className="mt-1 text-2xl font-semibold dark:text-slate-100">{op.business_name}</h1>
          <p className="text-sm text-muted dark:text-slate-400">
            {dossier.user_email ?? '(no email)'} · {op.category ?? 'no category'} · {op.timezone}
          </p>
        </div>
        <div className="text-right text-xs text-muted dark:text-slate-400">
          <div>Created {new Date(op.created_at).toLocaleString()}</div>
          <div>
            Onboarding: {op.onboarding_completed_at ? '✓ complete' : 'in progress'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Subscription" value={op.subscription_status ?? '—'} />
        <Stat
          label="Twilio number"
          value={op.twilio_number_e164 ?? '—'}
          mono
        />
        <Stat label="Calendar" value={op.google_calendar_id ? '✓ connected' : '—'} />
        <Stat
          label="Stripe Connect (charges/payouts)"
          value={`${op.stripe_connect_charges_enabled ? '✓' : '—'} / ${op.stripe_connect_payouts_enabled ? '✓' : '—'}`}
        />
        <Stat label="Conversations" value={dossier.totals.conversations.toString()} />
        <Stat label="Appts (confirmed)" value={dossier.totals.appointments_confirmed.toString()} />
        <Stat label="Appts (completed)" value={dossier.totals.appointments_completed.toString()} />
        <Stat
          label="Fee revenue"
          value={`$${(dossier.totals.fee_revenue_cents / 100).toFixed(2)}`}
        />
      </div>

      <OperatorActions
        operator={{
          id: op.id,
          business_name: op.business_name,
          has_subscription: op.stripe_subscription_id != null,
          has_twilio: op.twilio_number_e164 != null,
        }}
      />

      <OperatorTabs operatorId={op.id} />

      <details className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 text-xs">
        <summary className="cursor-pointer font-medium text-muted dark:text-slate-400">Provider links</summary>
        <ul className="mt-2 space-y-1 font-mono">
          {op.stripe_customer_id ? (
            <li>
              Stripe customer:{' '}
              <a
                className="text-accent dark:text-accent-light hover:underline"
                href={`https://dashboard.stripe.com/customers/${op.stripe_customer_id}`}
                target="_blank"
                rel="noreferrer"
              >
                {op.stripe_customer_id}
              </a>
            </li>
          ) : null}
          {op.stripe_subscription_id ? (
            <li>
              Subscription:{' '}
              <a
                className="text-accent dark:text-accent-light hover:underline"
                href={`https://dashboard.stripe.com/subscriptions/${op.stripe_subscription_id}`}
                target="_blank"
                rel="noreferrer"
              >
                {op.stripe_subscription_id}
              </a>
            </li>
          ) : null}
          {op.stripe_connect_account_id ? (
            <li>
              Stripe Connect account:{' '}
              <a
                className="text-accent dark:text-accent-light hover:underline"
                href={`https://dashboard.stripe.com/connect/accounts/${op.stripe_connect_account_id}`}
                target="_blank"
                rel="noreferrer"
              >
                {op.stripe_connect_account_id}
              </a>
            </li>
          ) : null}
          {op.twilio_number_sid ? (
            <li>
              Twilio number:{' '}
              <a
                className="text-accent dark:text-accent-light hover:underline"
                href={`https://console.twilio.com/us1/develop/phone-numbers/manage/incoming/${op.twilio_number_sid}`}
                target="_blank"
                rel="noreferrer"
              >
                {op.twilio_number_sid}
              </a>
            </li>
          ) : null}
        </ul>
      </details>
    </section>
  );
}

function Stat({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-paper dark:bg-slate-900 p-3">
      <div className="text-xs uppercase tracking-wide text-muted dark:text-slate-400">{label}</div>
      <div className={`mt-1 text-base ${mono ? 'font-mono' : ''} dark:text-slate-100`}>{value}</div>
    </div>
  );
}
