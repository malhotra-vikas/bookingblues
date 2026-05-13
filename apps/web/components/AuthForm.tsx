'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { publicEnv } from '../lib/env';
import { getSupabaseBrowserClient } from '../lib/supabase/browser';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }): JSX.Element {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get('next') ?? '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    const supabase = getSupabaseBrowserClient();
    try {
      if (mode === 'signup') {
        const trimmedName = businessName.trim();
        if (!trimmedName) throw new Error('Business name is required');
        const phoneE164 = normalizeUsPhone(phone);
        if (!phoneE164) throw new Error('Enter a valid US phone number');
        const { data: signupData, error: signupErr } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              business_name: trimmedName,
              personal_phone_e164: phoneE164,
            },
          },
        });
        if (signupErr) throw signupErr;
        const newUserId = signupData.user?.id;
        // Fire-and-forget Slack #bb-leads notification. Failure is silent —
        // signup already succeeded; the lead is in `auth.users` regardless.
        // user_id lets the claim button reconcile against auth.users later.
        if (newUserId) {
          void fetch(`${publicEnv.NEXT_PUBLIC_API_URL}/v1/leads/notify`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              user_id: newUserId,
              email,
              business_name: trimmedName,
              phone_e164: phoneE164,
            }),
            keepalive: true,
          }).catch(() => {
            // Intentionally swallowed.
          });
        }
        setInfo(
          "We sent a confirmation link to your email. Click it, then sign in to finish setup.",
        );
        return;
      }
      const { error: loginErr } = await supabase.auth.signInWithPassword({ email, password });
      if (loginErr) throw loginErr;
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {mode === 'signup' && (
        <>
          <Field
            id="business_name"
            label="Business name"
            placeholder="Zeus Electrical"
            value={businessName}
            onChange={setBusinessName}
            autoComplete="organization"
            required
          />
          <Field
            id="phone"
            label="Mobile phone (US)"
            type="tel"
            placeholder="(415) 555-1234"
            value={phone}
            onChange={setPhone}
            autoComplete="tel"
            required
            hint="We'll text this number when sales reaches out. Keep it the same number that takes your customer calls."
          />
        </>
      )}
      <Field
        id="email"
        label="Email"
        type="email"
        value={email}
        onChange={setEmail}
        autoComplete="email"
        required
      />
      <Field
        id="password"
        label="Password"
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
        minLength={8}
        required
      />
      {error ? (
        <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : null}
      {info ? (
        <div className="rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          {info}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-accent px-4 py-2.5 text-base font-medium text-white shadow-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
      >
        {busy ? 'Working…' : mode === 'signup' ? 'Create account' : 'Sign in'}
      </button>
      {mode === 'signup' ? (
        <p className="text-[11px] text-slate-500 dark:text-slate-400 text-center">
          By creating an account you agree to our terms. We&apos;ll only charge after the 7-day trial.
        </p>
      ) : null}
    </form>
  );
}

function Field({
  id, label, value, onChange, type = 'text', placeholder, autoComplete, required, minLength, hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (s: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  hint?: string;
}): JSX.Element {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium dark:text-slate-200">{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...(placeholder ? { placeholder } : {})}
        {...(autoComplete ? { autoComplete } : {})}
        {...(required ? { required: true } : {})}
        {...(minLength ? { minLength } : {})}
        className="mt-1 block w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 px-3 py-2 outline-none focus:border-accent"
      />
      {hint ? <p className="mt-1 text-xs text-muted dark:text-slate-400">{hint}</p> : null}
    </div>
  );
}

/**
 * Lightweight US E.164 normalization for signup. Server-side validates
 * strictly via libphonenumber-js — this is just a guard for the obvious
 * mistakes (letters, missing digits) so users get instant feedback.
 */
function normalizeUsPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}
