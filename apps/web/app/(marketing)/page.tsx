import Link from 'next/link';
import type { ReactNode } from 'react';

export default function HomePage(): JSX.Element {
  return (
    <div>
      {/* ── Hero (full-bleed soft band) ────────────────────────────────── */}
      <section className="border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white">
        <div className="max-w-5xl mx-auto px-6 py-16 sm:py-20 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <p className="inline-block text-[11px] font-semibold tracking-[0.18em] uppercase text-accent bg-blue-50 border border-blue-100 rounded-full px-3 py-1 mb-5">
              AI lead recovery for the trades
            </p>
            <h1 className="text-4xl sm:text-5xl font-semibold leading-[1.1] text-ink tracking-tight mb-5">
              The first to answer wins the job.
              <br />
              <span className="text-red-600">Stop letting voicemail win.</span>
            </h1>
            <p className="text-lg text-muted leading-relaxed mb-7 max-w-md">
              Our AI texts back missed calls in under 10 seconds — qualifies the lead, books the
              appointment, and collects a deposit. Before your competitor even picks up.
            </p>
            <div className="flex flex-wrap gap-3 mb-3">
              <CtaPrimary href="/signup">Start my free 7-day trial</CtaPrimary>
              <CtaSecondary href="/pricing">See pricing</CtaSecondary>
            </div>
            <p className="text-xs text-slate-500">
              Card on file to start · Cancel before day 7 and you won&apos;t be charged
            </p>
          </div>

          {/* Inline SMS-conversation mockup (no asset; pure markup) */}
          <SmsMockup />
        </div>
      </section>

      {/* ── What we do ──────────────────────────────────────────────────── */}
      <section className="border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <SectionLabel>What we do</SectionLabel>
          <SectionHeading>Your 24/7 AI dispatcher — without the payroll</SectionHeading>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
            <FeatureCard
              title="Instant text-back"
              body="Responds in <10 seconds. Customers feel heard before they dial the next number."
              icon={<IconBolt />}
            />
            <FeatureCard
              title="Lead qualification"
              body="AI scopes the job, urgency, and priority — so you show up to the right calls first."
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
        </div>
      </section>

      {/* ── Why it works ────────────────────────────────────────────────── */}
      <section className="border-b border-slate-200 bg-slate-50">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <SectionLabel>Why it works</SectionLabel>
          <SectionHeading>AI speed. Human oversight. Full transparency.</SectionHeading>

          <div className="grid grid-cols-3 gap-4 max-w-2xl mt-8 mb-10">
            <ProofStat num="<10s" label="Avg response time" />
            <ProofStat num="24/7" label="Always-on coverage" />
            <ProofStat num="7 days" label="Free to prove it" />
          </div>

          <div className="grid lg:grid-cols-2 gap-10">
            <div>
              <p className="text-[15px] text-muted leading-relaxed mb-4">
                Every conversation is monitored by our team — not just logged. If the AI makes a
                misstep, a human corrects it. You get the efficiency of automation with the
                accuracy you&apos;d expect from a trained dispatcher.
              </p>
              <p className="text-[15px] text-muted leading-relaxed">
                After each interaction, you receive a{' '}
                <strong className="font-medium text-ink">metadata summary email</strong> showing
                exactly what the AI said, what the customer needed, and the estimated revenue
                recovered.
              </p>
            </div>
            <blockquote className="bg-white border-l-4 border-accent rounded-r-md py-5 px-5 self-start shadow-sm">
              <p className="text-base italic text-ink leading-relaxed mb-2">
                &ldquo;It&apos;s like having a world-class receptionist who never sleeps, never
                takes a lunch break, and pays for herself in the first week.&rdquo;
              </p>
              <p className="text-xs text-muted">— Beta user, HVAC contractor</p>
            </blockquote>
          </div>
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────────────── */}
      <section className="border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <SectionLabel>How it works</SectionLabel>
          <SectionHeading>Three steps. Zero learning curve.</SectionHeading>

          <ol className="grid md:grid-cols-3 gap-6 mt-8 relative">
            <Step
              n={1}
              title="Connect your calendar"
              body="Google Calendar today — sync in minutes. CRM connectors (Jobber, ServiceTitan, Housecall Pro) coming soon."
            />
            <Step
              n={2}
              title="Miss a call — AI steps in"
              body="The bot engages your customer, qualifies the need, and books the job while you’re on the tools."
            />
            <Step
              n={3}
              title="Show up to a booked job"
              body="You get a summary email. The customer’s confirmed and deposited. You get to work."
            />
          </ol>

          <div className="mt-10 pt-6 border-t border-slate-200 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted">
            <TrustItem>Bank-grade encryption</TrustItem>
            <TrustItem>Human-monitored AI</TrustItem>
            <TrustItem>No long-term contracts</TrustItem>
            <TrustItem>Established 2026</TrustItem>
          </div>
        </div>
      </section>

      {/* ── Final CTA ───────────────────────────────────────────────────── */}
      <section className="bg-gradient-to-b from-white to-slate-50">
        <div className="max-w-3xl mx-auto px-6 py-20 text-center">
          <h2 className="text-3xl sm:text-4xl font-semibold text-ink tracking-tight mb-4">
            Ready to stop donating jobs to voicemail?
          </h2>
          <p className="text-lg text-muted mb-8">
            Try it free for 7 days. Cancel before the trial ends and you won&apos;t be charged a
            dime.
          </p>
          <div className="flex flex-wrap justify-center gap-3 mb-3">
            <CtaPrimary href="/signup">Claim my free week</CtaPrimary>
            <CtaSecondary href="/pricing">See pricing</CtaSecondary>
          </div>
          <p className="text-xs text-slate-500">
            Card on file to start · Works with Google Calendar today; Jobber, ServiceTitan, and
            Housecall Pro coming soon
          </p>
        </div>
      </section>
    </div>
  );
}

// ── Local components ────────────────────────────────────────────────────

function CtaPrimary({ href, children }: { href: string; children: ReactNode }): JSX.Element {
  return (
    <Link
      href={href}
      className="inline-block rounded-md bg-accent text-white px-6 py-3 text-base font-medium no-underline shadow-sm hover:bg-blue-700 transition-colors"
    >
      {children}
    </Link>
  );
}

function CtaSecondary({ href, children }: { href: string; children: ReactNode }): JSX.Element {
  return (
    <Link
      href={href}
      className="inline-block rounded-md border border-slate-300 bg-white text-ink px-6 py-3 text-base font-medium no-underline hover:border-slate-400 transition-colors"
    >
      {children}
    </Link>
  );
}

function SectionLabel({ children }: { children: ReactNode }): JSX.Element {
  return (
    <p className="text-xs font-semibold tracking-[0.16em] uppercase text-accent mb-3">
      {children}
    </p>
  );
}
function SectionHeading({ children }: { children: ReactNode }): JSX.Element {
  return (
    <h2 className="text-2xl sm:text-3xl font-semibold text-ink tracking-tight leading-tight max-w-2xl">
      {children}
    </h2>
  );
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
    <div className="rounded-lg bg-white border border-slate-200 p-5 hover:border-slate-300 hover:shadow-sm transition-all">
      <div className="text-accent mb-3">{icon}</div>
      <p className="text-[15px] font-medium text-ink mb-1.5">{title}</p>
      <p className="text-[13px] text-muted leading-relaxed">{body}</p>
    </div>
  );
}

function ProofStat({ num, label }: { num: string; label: string }): JSX.Element {
  return (
    <div className="rounded-lg bg-white border border-slate-200 p-4 text-center">
      <span className="block text-3xl font-semibold text-ink tracking-tight">{num}</span>
      <span className="block text-xs text-muted mt-1">{label}</span>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }): JSX.Element {
  return (
    <li className="flex flex-col items-start">
      <div className="w-12 h-12 rounded-full bg-accent text-white text-lg font-semibold flex items-center justify-center mb-4 shadow-sm">
        {n}
      </div>
      <p className="text-lg font-medium text-ink mb-2">{title}</p>
      <p className="text-sm text-muted leading-relaxed">{body}</p>
    </li>
  );
}

function TrustItem({ children }: { children: ReactNode }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <IconShield />
      <span>{children}</span>
    </span>
  );
}

function SmsMockup(): JSX.Element {
  return (
    <div className="relative max-w-sm mx-auto lg:mx-0 w-full">
      <div className="rounded-2xl bg-white border border-slate-200 shadow-lg p-5 space-y-3">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-accent/10 text-accent text-xs font-semibold flex items-center justify-center">
              ZE
            </div>
            <div>
              <p className="text-[13px] font-medium text-ink leading-none">Zeus Electrical</p>
              <p className="text-[11px] text-muted mt-0.5">+1 (415) 555-9387</p>
            </div>
          </div>
          <span className="text-[11px] text-emerald-600 font-medium">● Live</span>
        </div>

        <Bubble side="left" time="2:14 PM">
          Hi! Saw you tried to reach Zeus Electrical — they&apos;re on a service call. I can help
          schedule you. What&apos;s going on?
        </Bubble>
        <Bubble side="right" time="2:14 PM">
          Breaker keeps tripping in my garage. Need someone today if possible.
        </Bubble>
        <Bubble side="left" time="2:15 PM">
          Got it — sounds urgent. They&apos;re free Tue 9–11 AM or today 4–6 PM. Which works?
        </Bubble>
        <Bubble side="right" time="2:15 PM">
          Today 4 PM please.
        </Bubble>
        <Bubble side="left" time="2:15 PM" success>
          Booked ✅ Tue 4 PM with Zeus Electrical. $50 deposit secured. See you soon!
        </Bubble>
      </div>
      <div className="absolute -bottom-3 right-6 bg-emerald-600 text-white text-xs font-medium px-3 py-1 rounded-full shadow">
        Booked in 90 seconds
      </div>
    </div>
  );
}

function Bubble({
  side,
  time,
  success,
  children,
}: {
  side: 'left' | 'right';
  time: string;
  success?: boolean;
  children: ReactNode;
}): JSX.Element {
  const right = side === 'right';
  return (
    <div className={`flex flex-col ${right ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[13px] leading-snug ${
          success
            ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
            : right
            ? 'bg-accent text-white'
            : 'bg-slate-100 text-ink'
        }`}
      >
        {children}
      </div>
      <span className="text-[10px] text-slate-400 mt-0.5">{time}</span>
    </div>
  );
}

// ── Inline SVG icons ─────────────────────────────────────────────────────

function IconBolt(): JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />
    </svg>
  );
}
function IconClipboard(): JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="8" y="3" width="8" height="4" rx="1" />
      <path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />
      <path d="m9 13 2 2 4-4" />
    </svg>
  );
}
function IconCalendar(): JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}
function IconCard(): JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
