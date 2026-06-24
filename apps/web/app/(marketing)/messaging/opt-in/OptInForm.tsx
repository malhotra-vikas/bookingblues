'use client';

import Link from 'next/link';
import { useState } from 'react';

import { BRAND } from '../../../../lib/brand';
import { publicEnv } from '../../../../lib/env';

/**
 * Public SMS opt-in form. Posts to the API's public /v1/sms-opt-in endpoint,
 * which records a durable consent row (CLAUDE.md: web never holds the service
 * role; all DB writes go through the API).
 *
 * The consent checkbox label below is the canonical disclosure — it MUST stay
 * verbatim-identical to CONSENT_TEXT in
 * apps/api/src/modules/consent/sms-consent.dto.ts, which is what we store as
 * proof of what the user agreed to.
 */
export function OptInForm(): JSX.Element {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [trade, setTrade] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // SMS consent is OPTIONAL — the form completes whether or not the box is
      // checked (carrier/CTIA rule: opt-in must never gate registration). We
      // send the actual checkbox state; the API only records consent + lets us
      // text when it is true.
      const res = await fetch(`${publicEnv.NEXT_PUBLIC_API_URL}/v1/sms-opt-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          ...(trade.trim() ? { trade: trade.trim() } : {}),
          consent,
        }),
      });
      if (!res.ok) {
        let detail = 'Something went wrong. Please try again.';
        try {
          const body = (await res.json()) as { detail?: string };
          if (body.detail) detail = body.detail;
        } catch {
          /* ignore */
        }
        throw new Error(detail);
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
        {consent ? (
          <>
            Thanks — you&apos;re opted in. You can reply <strong>STOP</strong> to any message to opt
            out at any time.
          </>
        ) : (
          <>
            Thanks — we&apos;ve got your details. We <strong>won&apos;t</strong> send you automated
            texts since you didn&apos;t opt in. Come back and check the box anytime, or just give us
            a call.
          </>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field id="name" label="Your name" value={name} onChange={setName} autoComplete="name" required />
      <Field
        id="phone"
        label="Mobile number"
        type="tel"
        value={phone}
        onChange={setPhone}
        autoComplete="tel"
        placeholder="(555) 123-4567"
        hint="A US mobile number we can text."
        required
      />
      <Field
        id="trade"
        label="What do you need? (optional)"
        value={trade}
        onChange={setTrade}
        placeholder="e.g. water heater leak"
      />

      <label className="flex items-start gap-2 text-[13px] text-ink dark:text-slate-200 leading-snug">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 dark:border-slate-700 text-accent focus:ring-accent"
        />
        <span>
          I agree to receive recurring automated text messages from {BRAND.name} about scheduling my
          service appointment. Message frequency varies. Message and data rates may apply. Reply
          STOP to opt out, HELP for help. See our{' '}
          <Link href="/privacy" target="_blank" className="underline">
            Privacy Policy
          </Link>{' '}
          and{' '}
          <Link href="/terms" target="_blank" className="underline">
            Terms
          </Link>
          .
        </span>
      </label>
      <p className="text-xs text-muted dark:text-slate-400">
        Optional. You can submit without agreeing — we just won&apos;t be able to text you. Consent
        is never required to use our service.
      </p>

      {error ? (
        <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-accent px-4 py-2.5 text-base font-medium text-white shadow-sm hover:bg-accent-dark transition-colors disabled:opacity-50"
      >
        {busy ? 'Submitting…' : 'Submit'}
      </button>
    </form>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = 'text',
  hint,
  placeholder,
  autoComplete,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  hint?: string;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
}): JSX.Element {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium dark:text-slate-200">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        className="mt-1 block w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 px-3 py-2 outline-none focus:border-accent"
      />
      {hint ? <p className="mt-1 text-xs text-muted dark:text-slate-400">{hint}</p> : null}
    </div>
  );
}
