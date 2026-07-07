'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { getSupabaseBrowserClient } from '../../lib/supabase/browser';
import { publicEnv } from '../../lib/env';

/** Normalize a loosely-typed US number to E.164 (+1XXXXXXXXXX). Returns null if not 10/11 digits. */
function toE164(input: string): string | null {
  const d = input.replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return null;
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return fetch(`${publicEnv.NEXT_PUBLIC_API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

/**
 * Sales rep onboards a new client. Creates the client's account (invite email +
 * onboarding) auto-tagged to this rep, then refreshes the leads list.
 */
export function AddLeadForm(): JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const name = businessName.trim();
    const mail = email.trim().toLowerCase();
    const e164 = toE164(phone);
    if (!name) return setError('Business name is required');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return setError('Enter a valid email');
    if (!e164) return setError('Enter a valid US mobile number');

    setBusy(true);
    try {
      const res = await authedFetch('/v1/sales/leads', {
        method: 'POST',
        body: JSON.stringify({ email: mail, business_name: name, phone_e164: e164 }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail ?? `Couldn't add client (${res.status})`);
      }
      setInfo(`Invite sent to ${mail}. They'll set a password and finish onboarding — the lead is now yours.`);
      setBusinessName('');
      setEmail('');
      setPhone('');
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Add a new client</h2>
          <p className="text-xs text-muted">
            Onboard a client you signed. We&apos;ll email them to set up their account — the lead is
            auto-assigned to you.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v);
            setError(null);
            setInfo(null);
          }}
          className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white"
        >
          {open ? 'Cancel' : '+ Add client'}
        </button>
      </div>

      {info ? (
        <p className="mx-4 mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {info}
        </p>
      ) : null}

      {open ? (
        <form onSubmit={submit} className="border-t border-slate-100 px-4 py-4 space-y-3">
          <Field label="Business name" value={businessName} onChange={setBusinessName} placeholder="Zeus Plumbing" autoFocus />
          <Field label="Client email" type="email" value={email} onChange={setEmail} placeholder="owner@example.com" />
          <Field label="Mobile phone (US)" type="tel" value={phone} onChange={setPhone} placeholder="(415) 555-1234" />
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Adding…' : 'Send invite & add lead'}
          </button>
        </form>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoFocus?: boolean;
}): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink">{label}</span>
      <input
        type={type}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
    </label>
  );
}
