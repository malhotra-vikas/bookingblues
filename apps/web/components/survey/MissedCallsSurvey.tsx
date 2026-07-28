'use client';

import { useMemo, useState } from 'react';

import { BRAND } from '../../lib/brand';
import { publicEnv } from '../../lib/env';

/**
 * Questionnaire definition — the source of truth for wording.
 *
 * `code` is an internal stable identifier, NOT shown to the respondent: a
 * radio list already communicates "pick one", so rendering "A)" in front of
 * every option is just noise on screen. It exists so the answer survives a
 * reworded label — the API validates it against its own allowed-letter map and
 * prints it beside the label in the notification email, which keeps responses
 * tallyable across copy edits.
 *
 * So: reword a `label` here and it flows straight through to the inbox with no
 * server change. Adding or removing an option letter DOES require updating
 * ALLOWED_CODES in apps/api/src/modules/surveys/surveys.controller.ts.
 */
interface Question {
  readonly id: 'q1' | 'q2' | 'q3' | 'q4' | 'q5' | 'q6';
  readonly title: string;
  readonly hint?: string;
  readonly multi?: { readonly max: number };
  readonly options: ReadonlyArray<{ readonly code: string; readonly label: string }>;
}

const QUESTIONS: ReadonlyArray<Question> = [
  {
    id: 'q1',
    title: 'How many missed calls do you estimate you lose to voicemail or no answer in a typical week?',
    options: [
      { code: 'A', label: '1–3' },
      { code: 'B', label: '4–7' },
      { code: 'C', label: '8–15' },
      { code: 'D', label: '15+' },
      { code: 'E', label: "Not sure, but it's more than I'd like" },
    ],
  },
  {
    id: 'q2',
    title: 'What happens to most of those missed calls today?',
    options: [
      { code: 'A', label: 'They call a competitor' },
      { code: 'B', label: 'They leave a voicemail I call back later' },
      { code: 'C', label: 'I lose them completely — no idea' },
      { code: 'D', label: 'I have someone who handles it' },
      { code: 'E', label: 'Other' },
    ],
  },
  {
    id: 'q3',
    title: 'Which of these features would matter most to you?',
    hint: 'Pick your top 3.',
    multi: { max: 3 },
    options: [
      { code: 'A', label: 'Lead qualifying questions (budget, job type, timeline)' },
      { code: 'B', label: 'Human-in-the-loop emergency escalation' },
      { code: 'C', label: 'Automatic calendar booking' },
      { code: 'D', label: 'Deposit collection upfront' },
      { code: 'E', label: 'Job summary email after each booked call' },
      { code: 'F', label: 'After-hours handling only (nights/weekends)' },
      {
        code: 'G',
        label:
          'Predictive diagnostics from past jobs and other data (likely problem and parts needed)',
      },
    ],
  },
  {
    id: 'q4',
    title: 'What software do you currently use to run your business?',
    options: [
      { code: 'A', label: 'Housecall Pro' },
      { code: 'B', label: 'Jobber' },
      { code: 'C', label: 'ServiceTitan' },
      { code: 'D', label: 'Google Calendar only' },
      { code: 'E', label: 'Pen and paper / nothing' },
      { code: 'F', label: 'Other (drop it in comments)' },
    ],
  },
  {
    id: 'q5',
    title:
      'Would integration with your current software be a dealbreaker, or would you switch to a new booking calendar if the tool was good enough?',
    options: [
      { code: 'A', label: 'Has to integrate with what I already use — dealbreaker if not' },
      { code: 'B', label: "I'd switch calendars if the tool solved my problem" },
      { code: 'C', label: "I don't really use software, so doesn't matter" },
      { code: 'D', label: 'Depends on the integration' },
    ],
  },
  {
    id: 'q6',
    title: 'If this reliably converted even 2–3 more jobs a month, what would you pay per month?',
    options: [
      { code: 'A', label: '$0–$99' },
      { code: 'B', label: '$100–$199' },
      { code: 'C', label: '$200–$349' },
      { code: 'D', label: '$350–$499' },
      { code: 'E', label: "I'd rather pay per booking than monthly" },
    ],
  },
];

type Selections = Record<string, ReadonlyArray<string>>;

export interface MissedCallsSurveyProps {
  /** Prefilled from the emailed link (?email=&name=&business=&src=). */
  readonly prefill: {
    readonly email: string;
    readonly name: string;
    readonly business: string;
    readonly source: string;
  };
}

export function MissedCallsSurvey({ prefill }: MissedCallsSurveyProps): JSX.Element {
  const [selected, setSelected] = useState<Selections>({});
  const [contact, setContact] = useState({
    full_name: prefill.name,
    business_name: prefill.business,
    email: prefill.email,
    phone: '',
    comments: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const answered = useMemo(
    () => QUESTIONS.filter((q) => (selected[q.id]?.length ?? 0) > 0).length,
    [selected],
  );

  function toggle(q: Question, code: string): void {
    setError(null);
    setSelected((prev) => {
      const current = prev[q.id] ?? [];
      if (!q.multi) return { ...prev, [q.id]: [code] };
      if (current.includes(code)) return { ...prev, [q.id]: current.filter((c) => c !== code) };
      // At the cap, drop the oldest pick so the newest choice always registers —
      // silently ignoring the tap reads as a broken checkbox.
      const next = [...current, code].slice(-q.multi.max);
      return { ...prev, [q.id]: next };
    });
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);

    const missing = QUESTIONS.find((q) => (selected[q.id]?.length ?? 0) === 0);
    if (missing) {
      setError(
        `Please answer question ${QUESTIONS.indexOf(missing) + 1} — it only takes a moment.`,
      );
      document.getElementById(missing.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (contact.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email.trim())) {
      setError('That email address does not look right — fix it or leave it blank.');
      return;
    }

    // Send {code,label} pairs so the notification email carries the exact
    // wording the respondent saw.
    const answerFor = (q: Question): ReadonlyArray<{ code: string; label: string }> =>
      (selected[q.id] ?? []).map((code) => {
        const opt = q.options.find((o) => o.code === code)!;
        return { code: opt.code, label: opt.label };
      });

    const payload: Record<string, unknown> = {
      q1: answerFor(QUESTIONS[0]!)[0],
      q2: answerFor(QUESTIONS[1]!)[0],
      q3: answerFor(QUESTIONS[2]!),
      q4: answerFor(QUESTIONS[3]!)[0],
      q5: answerFor(QUESTIONS[4]!)[0],
      q6: answerFor(QUESTIONS[5]!)[0],
    };
    // Omit blank optional fields entirely — the API schema is `.strict()` and
    // rejects an empty string where it wants a real value.
    if (contact.full_name.trim()) payload.full_name = contact.full_name.trim();
    if (contact.business_name.trim()) payload.business_name = contact.business_name.trim();
    if (contact.email.trim()) payload.email = contact.email.trim().toLowerCase();
    if (contact.phone.trim()) payload.phone = contact.phone.trim();
    if (contact.comments.trim()) payload.comments = contact.comments.trim();
    if (prefill.source.trim()) payload.source = prefill.source.trim();

    setBusy(true);
    try {
      const res = await fetch(`${publicEnv.NEXT_PUBLIC_API_URL}/v1/surveys/missed-calls`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(detail.detail ?? `Could not submit (${res.status})`);
      }
      setDone(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur shadow-card p-8 text-center">
        <div className="text-4xl" aria-hidden>
          ✅
        </div>
        <h2 className="mt-3 text-2xl font-semibold text-ink dark:text-slate-100">
          Thanks — that helps a lot.
        </h2>
        <p className="mt-2 text-muted">
          Your answers went straight to our team. If you left an email we&apos;ll follow up with
          what we learned from operators like you.
        </p>
        <div className="mt-6 flex flex-wrap gap-3 justify-center">
          <a
            href={`https://${BRAND.domain}`}
            className="rounded-md bg-accent px-4 py-2 text-white no-underline"
          >
            See how {BRAND.name} works
          </a>
          <a
            href={BRAND.demoBookingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-slate-300 dark:border-slate-700 px-4 py-2 no-underline text-ink dark:text-slate-100"
          >
            Book a 15-min demo
          </a>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      {QUESTIONS.map((q, i) => {
        const picks = selected[q.id] ?? [];
        return (
          <fieldset
            key={q.id}
            id={q.id}
            className="rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur shadow-card p-6 scroll-mt-6"
          >
            <legend className="sr-only">{q.title}</legend>
            <p className="text-xs font-semibold tracking-[0.16em] uppercase text-accent">
              Question {i + 1} of {QUESTIONS.length}
            </p>
            <p className="mt-2 text-lg font-medium text-ink dark:text-slate-100">{q.title}</p>
            {q.hint ? (
              <p className="mt-1 text-sm text-muted">
                {q.hint}
                {q.multi ? ` (${picks.length}/${q.multi.max} selected)` : null}
              </p>
            ) : null}

            <div className="mt-4 grid gap-2">
              {q.options.map((opt) => {
                const isOn = picks.includes(opt.code);
                return (
                  <label
                    key={opt.code}
                    className={[
                      'flex items-start gap-3 rounded-lg border px-4 py-3 cursor-pointer transition',
                      isOn
                        ? 'border-accent bg-accent-soft/60 dark:bg-accent/10'
                        : 'border-slate-200 dark:border-slate-700 hover:border-accent/60',
                    ].join(' ')}
                  >
                    <input
                      type={q.multi ? 'checkbox' : 'radio'}
                      name={q.id}
                      value={opt.code}
                      checked={isOn}
                      onChange={() => toggle(q, opt.code)}
                      className="mt-1 accent-[color:var(--accent,#2563eb)]"
                    />
                    <span className="text-sm text-ink dark:text-slate-100">{opt.label}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}

      <fieldset className="rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur shadow-card p-6">
        <legend className="sr-only">About you</legend>
        <p className="text-xs font-semibold tracking-[0.16em] uppercase text-accent">
          About you — optional
        </p>
        <p className="mt-2 text-sm text-muted">
          Leave these blank to answer anonymously. Give us an email and we&apos;ll send you what we
          learn from other operators.
        </p>
        <div className="mt-4 grid sm:grid-cols-2 gap-3">
          <Field
            label="Your name"
            value={contact.full_name}
            onChange={(v) => setContact((c) => ({ ...c, full_name: v }))}
            autoComplete="name"
          />
          <Field
            label="Business name"
            value={contact.business_name}
            onChange={(v) => setContact((c) => ({ ...c, business_name: v }))}
            autoComplete="organization"
          />
          <Field
            label="Email"
            type="email"
            value={contact.email}
            onChange={(v) => setContact((c) => ({ ...c, email: v }))}
            autoComplete="email"
          />
          <Field
            label="Phone"
            type="tel"
            value={contact.phone}
            onChange={(v) => setContact((c) => ({ ...c, phone: v }))}
            autoComplete="tel"
          />
        </div>
        <label className="mt-3 block">
          <span className="text-sm text-muted">Anything else? (comments)</span>
          <textarea
            value={contact.comments}
            onChange={(e) => setContact((c) => ({ ...c, comments: e.target.value }))}
            rows={3}
            maxLength={2000}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-ink dark:text-slate-100"
          />
        </label>
      </fieldset>

      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-accent px-5 py-2.5 text-white font-medium disabled:opacity-60"
        >
          {busy ? 'Sending…' : 'Submit answers'}
        </button>
        <span className="text-sm text-muted">
          {answered}/{QUESTIONS.length} answered
        </span>
      </div>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
}): JSX.Element {
  return (
    <label className="block">
      <span className="text-sm text-muted">{label}</span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-ink dark:text-slate-100"
      />
    </label>
  );
}
