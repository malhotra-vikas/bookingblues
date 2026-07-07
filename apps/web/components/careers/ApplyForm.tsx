'use client';

import { useState } from 'react';

import { BRAND } from '../../lib/brand';
import { publicEnv } from '../../lib/env';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

/**
 * Careers application form → POST /v1/careers/apply (emails the team via Resend).
 * Resume is collected as a shareable link (no file upload) to keep it simple and
 * serverless-friendly; the applicant email is set as reply-to.
 */
export function ApplyForm(): JSX.Element {
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    experience_years: 'None yet',
    sold_on_commission: 'Yes',
    relevant_experience: '',
    state: '',
    availability: 'Immediately',
    resume_url: '',
    cover_letter: '',
  });
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  function onFile(e: React.ChangeEvent<HTMLInputElement>): void {
    setError(null);
    const file = e.target.files?.[0] ?? null;
    if (file && file.size > 5 * 1024 * 1024) {
      e.target.value = '';
      setResumeFile(null);
      setError('Resume is too large (max 5MB).');
      return;
    }
    setResumeFile(file);
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!form.full_name.trim()) return setError('Your name is required');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) return setError('Enter a valid email');
    if (form.phone.trim().length < 7) return setError('Enter a valid phone number');
    setBusy(true);
    try {
      // multipart/form-data — the resume rides along as a real file the API
      // attaches to the email. Do NOT set content-type; the browser adds the
      // multipart boundary automatically.
      const fd = new FormData();
      fd.append('full_name', form.full_name.trim());
      fd.append('email', form.email.trim().toLowerCase());
      fd.append('phone', form.phone.trim());
      fd.append('experience_years', form.experience_years);
      fd.append('sold_on_commission', form.sold_on_commission);
      fd.append('relevant_experience', form.relevant_experience.trim());
      fd.append('state', form.state);
      fd.append('availability', form.availability);
      if (form.resume_url.trim()) fd.append('resume_url', form.resume_url.trim());
      fd.append('cover_letter', form.cover_letter.trim());
      if (resumeFile) fd.append('resume', resumeFile, resumeFile.name);

      const res = await fetch(`${publicEnv.NEXT_PUBLIC_API_URL}/v1/careers/apply`, {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail ?? `Could not submit (${res.status})`);
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30 p-6 text-center">
        <p className="text-lg font-semibold text-emerald-800 dark:text-emerald-200">Application received 🎉</p>
        <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">
          Thanks, {form.full_name.split(' ')[0]}! We usually reply within a day. Keep an eye on{' '}
          {form.email}.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur shadow-card p-6 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" value={form.full_name} onChange={set('full_name')} placeholder="Jordan Reyes" required />
        <Field label="Phone" type="tel" value={form.phone} onChange={set('phone')} placeholder="(555) 010-0199" required />
      </div>
      <Field label="Email" type="email" value={form.email} onChange={set('email')} placeholder="jordan@email.com" required />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Years of sales / canvassing experience" value={form.experience_years} onChange={set('experience_years')}
          options={['None yet', 'Less than 1 year', '1–3 years', '3–5 years', '5+ years']} />
        <Select label="Sold on straight commission before?" value={form.sold_on_commission} onChange={set('sold_on_commission')}
          options={['Yes', 'No']} />
      </div>
      <TextArea label="What's the most relevant sales or canvassing experience you have?"
        value={form.relevant_experience} onChange={set('relevant_experience')}
        placeholder="Door-to-door, phone sales, retail, trade industry, referral networks — whatever applies." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="State (US only)" value={form.state} onChange={set('state')} options={['', ...US_STATES]} placeholder="Select your state…" />
        <Select label="Availability to start" value={form.availability} onChange={set('availability')}
          options={['Immediately', 'Within 2 weeks', 'Within a month', 'Just exploring']} />
      </div>
      <div>
        <Label>Resume</Label>
        <input
          type="file"
          accept=".pdf,.doc,.docx,.rtf,.txt,.odt,.pages"
          onChange={onFile}
          className="block w-full text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-accent-soft file:px-3 file:py-2 file:text-sm file:font-medium file:text-accent"
        />
        <span className="mt-1 block text-xs text-muted">
          PDF, Word, RTF, TXT, ODT, or Pages · max 5MB{resumeFile ? ` · attached: ${resumeFile.name}` : ''}
        </span>
      </div>
      <Field label="…or paste a resume link" value={form.resume_url} onChange={set('resume_url')} placeholder="https://…" hint="Optional — Google Drive, Dropbox, LinkedIn, etc." />
      <TextArea label="Cover letter / message" value={form.cover_letter} onChange={set('cover_letter')}
        placeholder="Tell us about your sales background, or why straight commission works for you." />

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button type="submit" disabled={busy}
        className="w-full rounded-xl bg-brand-sheen px-4 py-3 text-base font-semibold text-white shadow-glow disabled:opacity-50">
        {busy ? 'Submitting…' : 'Submit application →'}
      </button>
    </form>
  );
}

function Label({ children }: { children: React.ReactNode }): JSX.Element {
  return <span className="mb-1 block text-xs font-medium text-ink dark:text-slate-200">{children}</span>;
}
const inputCls =
  'w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm';

function Field({ label, value, onChange, type = 'text', placeholder, required, hint }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; required?: boolean; hint?: string;
}): JSX.Element {
  return (
    <label className="block">
      <Label>{label}</Label>
      <input type={type} value={value} required={required} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} className={inputCls} />
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

function TextArea({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}): JSX.Element {
  return (
    <label className="block">
      <Label>{label}</Label>
      <textarea value={value} rows={3} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={inputCls} />
    </label>
  );
}

function Select({ label, value, onChange, options, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]; placeholder?: string;
}): JSX.Element {
  return (
    <label className="block">
      <Label>{label}</Label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o === '' ? (placeholder ?? 'Select…') : o}
          </option>
        ))}
      </select>
    </label>
  );
}
