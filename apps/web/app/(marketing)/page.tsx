import Link from 'next/link';
import type { ReactNode } from 'react';

export default function HomePage(): JSX.Element {
  return (
    <div className="max-w-2xl mx-auto">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="text-center px-6 pt-12 pb-8 border-b border-slate-200">
        <p className="text-xs font-medium tracking-widest uppercase text-accent mb-4">
          AI-powered lead recovery for the trades
        </p>
        <h1 className="text-3xl sm:text-4xl font-medium leading-tight text-ink mb-4">
          The first to answer wins the job.
          <br />
          <span className="text-red-600">Stop letting voicemail win.</span>
        </h1>
        <p className="text-base sm:text-[17px] text-muted leading-relaxed max-w-md mx-auto mb-8">
          Our AI texts back missed calls in under 10 seconds — qualifies the lead, books the
          appointment, and collects a deposit. Before your competitor even picks up.
        </p>
        <CtaStack />
      </section>

      {/* ── What we do ───────────────────────────────────────────────────── */}
      <section className="px-6 py-10 border-b border-slate-200">
        <SectionLabel>What we do</SectionLabel>
        <SectionHeading>Your 24/7 AI dispatcher — without the payroll</SectionHeading>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FeatureCard
            title="Instant text-back"
            body="Responds in <10 seconds. Customers feel heard before they dial the next number."
            icon={<IconBolt />}
          />
          <FeatureCard
            title="Lead qualification"
            body="AI determines job scope, urgency, and priority — so you show up to the right calls first."
            icon={<IconClipboard />}
          />
          <FeatureCard
            title="Real-time booking"
            body="Syncs live with Google Calendar today. Jobber, ServiceTitan, and Housecall Pro coming soon."
            icon={<IconCalendar />}
          />
          <FeatureCard
            title="Deposit collection"
            body="Locks in the appointment via Stripe (Clover coming soon). Eliminates no-shows before you drive out."
            icon={<IconCard />}
          />
        </div>
      </section>

      {/* ── Why it works ─────────────────────────────────────────────────── */}
      <section className="px-6 py-10 border-b border-slate-200">
        <SectionLabel>Why it works</SectionLabel>
        <SectionHeading>AI speed. Human oversight. Full transparency.</SectionHeading>

        <div className="flex flex-wrap gap-3 mb-6">
          <ProofStat num="<10s" label="Average response time" />
          <ProofStat num="24/7" label="Always-on coverage" />
          <ProofStat num="7 days" label="Free to prove it" />
        </div>

        <p className="text-[15px] text-muted leading-relaxed mb-4">
          Every conversation is monitored by our team — not just logged. If the AI makes a misstep,
          a human corrects it. You get the efficiency of automation with the accuracy you&apos;d
          expect from a trained dispatcher.
        </p>
        <p className="text-[15px] text-muted leading-relaxed mb-6">
          After each interaction, you receive a{' '}
          <strong className="font-medium text-ink">metadata summary email</strong> showing exactly
          what the AI said, what the customer needed, and the estimated revenue recovered.
        </p>

        <blockquote className="border-l-[3px] border-accent bg-slate-50 rounded-r-md py-3 px-4 my-6">
          <p className="text-[15px] italic text-ink leading-relaxed mb-1.5">
            &ldquo;It&apos;s like having a world-class receptionist who never sleeps, never takes a
            lunch break, and pays for herself in the first week.&rdquo;
          </p>
          <p className="text-xs text-muted">— Beta user, HVAC contractor</p>
        </blockquote>

        <CtaStack align="left" />
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section className="px-6 py-10 border-b border-slate-200">
        <SectionLabel>How it works</SectionLabel>
        <SectionHeading>Three steps. Zero learning curve.</SectionHeading>

        <ol className="flex flex-col gap-4 mb-6">
          <Step
            n={1}
            title="Connect your calendar"
            body="Google Calendar today — sync in minutes. CRM connectors (Jobber, ServiceTitan, Housecall Pro) coming soon."
          />
          <Step
            n={2}
            title="Miss a call — AI steps in"
            body="The bot engages your customer, qualifies their need, and books the job while you’re on the tools."
          />
          <Step
            n={3}
            title="Show up to a booked job"
            body="You get a summary email. The customer’s confirmed and deposited. You get to work."
          />
        </ol>

        <div className="flex flex-wrap gap-2">
          <TrustPill>Bank-grade encryption</TrustPill>
          <TrustPill>Human-monitored AI</TrustPill>
          <TrustPill>No long-term contracts</TrustPill>
          <TrustPill>Established 2026</TrustPill>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────────── */}
      <section className="text-center px-6 py-12 bg-slate-50">
        <h2 className="text-2xl font-medium text-ink mb-3">
          Ready to stop donating jobs to voicemail?
        </h2>
        <p className="text-base text-muted mb-8">
          Try it free for 7 days. Cancel before the trial ends and you won&apos;t be charged a
          dime.
        </p>
        <div className="flex flex-col items-center gap-2">
          <Link
            href="/signup"
            className="inline-block bg-blue-50 text-accent border-[1.5px] border-blue-200 rounded-lg px-8 py-3.5 font-medium no-underline hover:bg-blue-100"
          >
            Claim my free week
          </Link>
          <span className="text-[13px] text-slate-500">
            Card on file to start &nbsp;·&nbsp; Works with Google Calendar today; Jobber,
            ServiceTitan, and Housecall Pro coming soon
          </span>
        </div>
      </section>
    </div>
  );
}

// ── Local components ────────────────────────────────────────────────────

function CtaStack({ align = 'center' }: { align?: 'center' | 'left' }): JSX.Element {
  return (
    <div className={`flex flex-col gap-2 ${align === 'center' ? 'items-center' : 'items-start'}`}>
      <Link
        href="/signup"
        className="inline-block bg-blue-50 text-accent border-[1.5px] border-blue-200 rounded-lg px-8 py-3.5 font-medium no-underline hover:bg-blue-100"
      >
        Start my free 7-day trial
      </Link>
      <span className="text-[13px] text-slate-500">
        Card on file to start &nbsp;·&nbsp; Cancel anytime before day 7 and you won&apos;t be
        charged
      </span>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }): JSX.Element {
  return (
    <p className="text-xs font-medium tracking-wider uppercase text-muted mb-2">{children}</p>
  );
}
function SectionHeading({ children }: { children: ReactNode }): JSX.Element {
  return <h2 className="text-[22px] font-medium text-ink leading-snug mb-6">{children}</h2>;
}

function FeatureCard({
  title,
  body,
  icon,
}: {
  title: string;
  body: string;
  icon: ReactNode;
}): JSX.Element {
  return (
    <div className="bg-slate-50 rounded-lg p-4">
      <div className="text-accent mb-2">{icon}</div>
      <p className="text-sm font-medium text-ink mb-1">{title}</p>
      <p className="text-[13px] text-muted leading-relaxed">{body}</p>
    </div>
  );
}

function ProofStat({ num, label }: { num: string; label: string }): JSX.Element {
  return (
    <div className="flex-1 min-w-[120px] bg-slate-50 rounded-md p-4 text-center">
      <span className="block text-3xl font-medium text-ink">{num}</span>
      <span className="block text-xs text-muted mt-0.5">{label}</span>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }): JSX.Element {
  return (
    <li className="flex gap-4 items-start">
      <div className="w-8 h-8 rounded-full bg-blue-50 text-accent text-sm font-medium flex items-center justify-center shrink-0">
        {n}
      </div>
      <div className="pt-1">
        <p className="text-[15px] font-medium text-ink mb-1">{title}</p>
        <p className="text-sm text-muted leading-relaxed">{body}</p>
      </div>
    </li>
  );
}

function TrustPill({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-full px-3.5 py-1.5 text-[13px] text-muted">
      <IconShield />
      <span>{children}</span>
    </div>
  );
}

// ── Inline SVG icons (currentColor; sized small) ─────────────────────────

function IconBolt(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />
    </svg>
  );
}
function IconClipboard(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="8" y="3" width="8" height="4" rx="1" />
      <path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />
      <path d="m9 13 2 2 4-4" />
    </svg>
  );
}
function IconCalendar(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}
function IconCard(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20M6 15h2" />
    </svg>
  );
}
function IconShield(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
