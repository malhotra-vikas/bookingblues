import type { Metadata } from 'next';

import { ApplyForm } from '../../../components/careers/ApplyForm';
import { BRAND } from '../../../lib/brand';

export const metadata: Metadata = {
  title: 'Careers — KeeprSteady',
  description:
    'Sell an AI dispatcher that sells itself. Direct Marketing Representative — 1099, remote, straight commission with 25% residuals on every signed lead for as long as they stay a customer.',
  alternates: { canonical: '/careers' },
};

export default function CareersPage(): JSX.Element {
  return (
    <div className="px-6 py-12 max-w-3xl mx-auto">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <header className="text-center max-w-2xl mx-auto">
        <span className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" /> We&apos;re hiring — direct marketing reps
        </span>
        <p className="mt-3 text-sm text-muted">🇺🇸 US applicants only — 1099 independent contractor role</p>
        <h1 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight text-ink dark:text-slate-100">
          Sell an AI dispatcher that sells itself.
        </h1>
        <p className="mt-4 text-muted">
          Bring {BRAND.name} to plumbers, HVAC techs, roofers, and electricians who are losing jobs
          to voicemail. Straight commission,{' '}
          <span className="font-semibold text-ink dark:text-slate-100">25% residuals</span> on every
          signed lead, for as long as they stay a customer.
        </p>
        <div className="mt-6 flex justify-center">
          <a href="#apply" className="inline-flex items-center justify-center rounded-xl bg-brand-sheen px-5 py-3 text-base font-semibold text-white no-underline shadow-glow transition-all duration-300 hover:-translate-y-0.5">
            Apply now →
          </a>
        </div>
      </header>

      {/* ── Stats ────────────────────────────────────────────────────────── */}
      <section className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-4 rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 p-6 text-center">
        <Stat value="25%" label="Residuals per signed lead" />
        <Stat value="100%" label="Commission — uncapped" />
        <Stat value="Remote" label="Set your own schedule" />
      </section>

      {/* ── The role ─────────────────────────────────────────────────────── */}
      <section className="mt-14">
        <p className="text-xs font-semibold tracking-[0.16em] uppercase text-accent">The role</p>
        <h2 className="mt-2 text-2xl font-semibold text-ink dark:text-slate-100">Direct Marketing Representative</h2>
        <p className="mt-3 text-sm text-muted leading-relaxed">
          {BRAND.name} is an AI assistant that texts back missed calls for home-service businesses,
          books the job, and puts it on the calendar in under 10 seconds. Your job is to get it in
          front of the people who need it most: plumbers, HVAC techs, roofers, electricians, and
          locksmiths who are bleeding emergency calls to voicemail every week.
        </p>
        <p className="mt-3 text-sm text-muted leading-relaxed">
          You&apos;ll run outreach — door-to-door, phone, referral networks, trade events, whatever
          works in your territory — pitch the free 7-day trial, and get owners signed up. Every
          account you close keeps paying you as long as they stay a customer.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Card title="Compensation">
            <Bullet>Straight commission — no cap on what you earn</Bullet>
            <Bullet>25% residual on every signed lead, paid monthly for the life of the account</Bullet>
            <Bullet>Paid weekly on new signups; residuals paid on the same cycle</Bullet>
            <Bullet>Top reps building a book of 15+ active accounts</Bullet>
          </Card>
          <Card title="Location &amp; schedule">
            <Bullet>Remote / field-based — work your own territory</Bullet>
            <Bullet>Set your own hours — this is a self-directed, commission-only role</Bullet>
            <Bullet>1099 independent contractor</Bullet>
            <Bullet>Weekly team check-in call (optional but recommended)</Bullet>
          </Card>
        </div>

        <Card title="What we&apos;re looking for" className="mt-4">
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <Bullet>Comfortable with straight commission — self-starter, coin-operated</Bullet>
            <Bullet>Prior sales, canvassing, or trade-industry experience a plus</Bullet>
            <Bullet>Can clearly explain a simple pitch to busy contractors</Bullet>
            <Bullet>Reliable phone, transportation for in-person outreach</Bullet>
            <Bullet>Organized enough to track leads and follow up</Bullet>
            <Bullet>Thick skin — this is door-knocking and cold outreach</Bullet>
          </div>
        </Card>
      </section>

      {/* ── About ────────────────────────────────────────────────────────── */}
      <section className="mt-10 rounded-2xl bg-slate-50 dark:bg-slate-900 p-6 text-center">
        <p className="text-xs font-semibold tracking-[0.16em] uppercase text-accent">About {BRAND.name}</p>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted leading-relaxed">
          {BRAND.name} is an AI dispatcher for home-service businesses, operated by {BRAND.legalEntity}.
          When a contractor can&apos;t answer a call, {BRAND.name} texts the caller back in under 10
          seconds, answers their questions, books the appointment, and adds it straight to the
          contractor&apos;s Google Calendar — every conversation monitored by a human team. It&apos;s a
          real product with a free 7-day trial, sold to an industry that&apos;s easy to explain and easy
          to demo.
        </p>
      </section>

      {/* ── Apply ────────────────────────────────────────────────────────── */}
      <section id="apply" className="mt-16 scroll-mt-20">
        <div className="text-center">
          <p className="text-xs font-semibold tracking-[0.16em] uppercase text-accent">Apply</p>
          <h2 className="mt-2 text-2xl font-semibold text-ink dark:text-slate-100">Ready to start selling?</h2>
          <p className="mt-1 text-sm text-muted">Fill this out and it&apos;ll land straight in our inbox — we usually reply within a day.</p>
        </div>
        <div className="mt-6">
          <ApplyForm />
        </div>
      </section>

      {/* ── Prefer to talk ───────────────────────────────────────────────── */}
      <section className="mt-12 text-center">
        <h2 className="text-lg font-semibold text-ink dark:text-slate-100">Prefer to talk first?</h2>
        <p className="mt-1 text-sm text-muted">
          Grab 15 minutes on our calendar — no application needed to get your questions answered.
        </p>
        <a href={BRAND.careersBookingUrl} target="_blank" rel="noopener noreferrer"
          className="mt-4 inline-flex items-center justify-center rounded-xl border border-slate-300 dark:border-slate-700 px-5 py-3 text-sm font-semibold text-ink dark:text-slate-100 no-underline hover:border-accent/40 hover:bg-accent-soft">
          Book a 15-minute intro call
        </a>
      </section>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }): JSX.Element {
  return (
    <div>
      <div className="font-display text-2xl font-bold text-gradient">{value}</div>
      <div className="mt-1 text-xs text-muted">{label}</div>
    </div>
  );
}

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }): JSX.Element {
  return (
    <div className={`rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 p-5 ${className ?? ''}`}>
      <p className="text-xs font-semibold tracking-[0.14em] uppercase text-accent">{title}</p>
      <ul className="mt-3 space-y-2 text-sm text-ink dark:text-slate-100">{children}</ul>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <li className="flex items-start gap-2">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="text-accent mt-1 shrink-0" aria-hidden="true">
        <path d="m5 12 5 5L20 7" />
      </svg>
      <span>{children}</span>
    </li>
  );
}
