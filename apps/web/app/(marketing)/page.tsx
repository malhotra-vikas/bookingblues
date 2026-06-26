import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Reveal } from '../../components/Reveal';
import { BRAND, TRIAL_COPY } from '../../lib/brand';

export const metadata: Metadata = {
  title: `${BRAND.name} — AI booking assistant for home-service businesses`,
  description:
    `${BRAND.name} is an AI assistant for home-service businesses. When you can't answer a call, it texts the caller back, books the appointment, and adds it to your Google Calendar. Built for plumbers, HVAC, roofers, and electricians. Free 7-day trial.`,
  alternates: { canonical: '/' },
};

export default function HomePage(): JSX.Element {
  return (
    <div>
      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-slate-200/70 bg-gradient-to-b from-accent-soft via-white to-white">
        {/* Animated brand-purple blobs for ambient depth + motion. */}
        <div aria-hidden className="blob h-72 w-72 bg-accent-glow/30 -top-16 -left-10 animate-blob" />
        <div aria-hidden className="blob h-96 w-96 bg-accent-violet/25 -top-24 right-0 animate-blob [animation-delay:4s]" />
        <div aria-hidden className="blob h-72 w-72 bg-accent/15 top-48 left-1/2 animate-blob [animation-delay:8s]" />

        <div className="relative max-w-6xl mx-auto px-6 py-20 sm:py-28 grid lg:grid-cols-2 gap-12 items-center">
          <div className="reveal">
            <p className="inline-flex items-center gap-2 text-[11px] font-semibold tracking-[0.16em] uppercase text-accent bg-white/70 backdrop-blur ring-1 ring-accent/15 rounded-full px-3 py-1.5 mb-6 shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
              AI lead recovery for home service pros
            </p>
            <h1 className="font-display text-4xl sm:text-6xl font-semibold leading-[1.04] text-ink tracking-tight mb-6">
              Home service pros:
              <br />
              <span className="text-gradient animate-sheen">never miss another emergency call.</span>
            </h1>
            <p className="text-lg text-muted leading-relaxed mb-4 max-w-md">
              <strong className="font-semibold text-ink">{BRAND.name} is an AI assistant for
              home-service businesses.</strong> When you can&apos;t answer a call, it texts the
              caller back within 10 seconds, answers their questions, books the appointment, and
              adds it to your <strong className="font-semibold text-ink">Google Calendar</strong> —
              so you don&apos;t lose the customer to the next contractor.
            </p>
            <p className="text-sm text-muted mb-8 max-w-md">
              {BRAND.name} connects to your Google Calendar to read your availability and create the
              booking. Works for plumbers, HVAC techs, roofers, electricians, and locksmiths.
            </p>
            <div className="flex flex-wrap gap-3 mb-4">
              <CtaPrimary href="/signup">Start free 7-day trial</CtaPrimary>
              <CtaSecondary href={BRAND.demoBookingUrl} external>
                Book a 15-min demo
              </CtaSecondary>
            </div>
            <p className="text-xs text-slate-500">{TRIAL_COPY.cardOnFile}</p>
            <p className="text-xs text-slate-500 mt-1">
              {TRIAL_COPY.durationLabel} — no charge until day 8.
            </p>
          </div>

          {/* Inline SMS-conversation mockup — floated over a soft brand glow. */}
          <div className="relative reveal [animation-delay:150ms]">
            <div aria-hidden className="absolute -inset-6 bg-brand-sheen opacity-20 blur-3xl rounded-[2.5rem]" />
            <div className="relative animate-float">
              <SmsMockup />
            </div>
          </div>
        </div>
      </section>

      {/* ── What we do ──────────────────────────────────────────────────── */}
      <section className="border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <SectionLabel>What we do</SectionLabel>
          <SectionHeading>Your 24/7 AI dispatcher — without the payroll</SectionHeading>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-8 items-stretch">
            <Reveal delay={0} className="h-full">
              <FeatureCard
                title="Instant text-back"
                body="Responds in <10 seconds. Homeowner feels heard before they dial the next contractor in the search results."
                icon={<IconBolt />}
              />
            </Reveal>
            <Reveal delay={90} className="h-full">
              <FeatureCard
                title="Trade-specific vetting"
                body="Asks the right questions for your trade — leak vs install, system age, storm damage, owner vs tenant, ZIP — so you show up to the right jobs first."
                icon={<IconClipboard />}
              />
            </Reveal>
            <Reveal delay={180} className="h-full">
              <FeatureCard
                title="Emergency alerts"
                body="Burst pipe, gas smell, no AC at 95°, sewage backup — you get an SMS the moment those words come through. Call them back in 30 seconds, win the job."
                icon={<IconBolt />}
              />
            </Reveal>
            <Reveal delay={270} className="h-full">
              <FeatureCard
                title="Calendar + deposit"
                body="Books a 90-min slot on your Google Calendar. Optional non-refundable deposit via Stripe — kills no-shows before you drive out."
                icon={<IconCalendar />}
              />
            </Reveal>
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
            <div className="space-y-4 text-[15px] text-muted leading-relaxed">
              <p>
                Every conversation is monitored by our team — not just logged. If the AI makes a
                misstep, a human corrects it. You get the efficiency of automation with the
                accuracy you&apos;d expect from a trained dispatcher.
              </p>
              <p>
                After each interaction, you receive a{' '}
                <strong className="font-medium text-ink">metadata summary email</strong> showing
                exactly what the AI said, what the customer needed, and the estimated revenue
                recovered.
              </p>
              <p>
                <strong className="font-medium text-ink">You set the deposit — we add our fee on top, charged to the customer.</strong>{' '}
                You always receive 100% of the deposit you set. Our incentive is exactly the
                same as yours: book more jobs.
              </p>
            </div>
            <div className="card-lift rounded-2xl border border-slate-200/70 bg-white p-6 shadow-card">
              <p className="text-xs font-semibold tracking-[0.16em] uppercase text-accent mb-3">
                What you get after every call
              </p>
              <p className="text-sm text-muted leading-relaxed">
                A job summary email with the caller&apos;s description, likely parts, urgency,
                and quoted price range. Designed so you can load the truck before driving.
              </p>
              <AppointmentEmailMockup />
            </div>
          </div>
        </div>
      </section>

      {/* ── See it in action (mockups) ───────────────────────────────────── */}
      <section className="border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <SectionLabel>See it in action</SectionLabel>
          <SectionHeading>From missed call to booked job — without you lifting a finger</SectionHeading>

          <div className="grid lg:grid-cols-2 gap-6 mt-8">
            <DashboardMockup />
            <JobBriefMockup />
          </div>
        </div>
      </section>

      {/* ── Competitive differentiation ──────────────────────────────────── */}
      <section className="border-b border-slate-200 bg-slate-50">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <SectionLabel>Why {BRAND.name}</SectionLabel>
          <SectionHeading>Faster and cheaper than humans. Smarter and safer than raw automation.</SectionHeading>

          <div className="mt-8 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-3 py-3 font-medium"></th>
                  <th className="px-3 py-3 font-medium">Live answering service</th>
                  <th className="px-3 py-3 font-medium">Basic missed-call text</th>
                  <th className="px-3 py-3 font-medium bg-accent/5 text-accent">
                    {BRAND.name}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                <CompareRow label="Monthly cost" a="$400–$1,200" b="$25–$75" c="$49 starting" />
                <CompareRow label="Availability" a="Office hours, often US-only" b="24/7" c="24/7" />
                <CompareRow label="Avg response time" a="3–8 min" b="<10 sec (canned)" c="<10 sec" />
                <CompareRow label="Books on your calendar" a="Sometimes" b="No" c="Yes — direct to Google Calendar" />
                <CompareRow label="Human oversight" a="Yes (it is a human)" b="No" c="Yes — every conversation monitored, real-time correction" />
                <CompareRow label="Booking fee alignment" a="Flat per-call charge" b="None" c="You get 100% of the deposit; we add our fee on top" />
              </tbody>
            </table>
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
              title="Forward your missed calls"
              body="Set up carrier conditional forwarding on your cell — takes 60 seconds, we show you exactly how. Google Calendar syncs in minutes; Jobber and Housecall Pro coming soon."
            />
            <Step
              n={2}
              title="Miss a call — AI steps in"
              body="Caller gets a text in under 10 seconds. The bot asks the right trade-specific questions, books a 90-minute slot, and (optionally) collects a deposit."
            />
            <Step
              n={3}
              title="Show up to a booked job"
              body="Job summary email with the caller's description, likely parts, and quoted price range. You load the truck before driving."
            />
          </ol>

          <div className="mt-10 pt-6 border-t border-slate-200 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted">
            <TrustItem>Bank-grade encryption</TrustItem>
            <TrustItem>Human-monitored AI</TrustItem>
            <TrustItem>No long-term contracts</TrustItem>
            <TrustItem>Aligned incentives — we earn when you earn</TrustItem>
          </div>
        </div>
      </section>

      {/* ── Final CTA ───────────────────────────────────────────────────── */}
      <section className="bg-gradient-to-b from-white to-slate-50">
        <div className="max-w-3xl mx-auto px-6 py-20 text-center">
          <h2 className="text-3xl sm:text-4xl font-semibold text-ink tracking-tight mb-4">
            Stop donating jobs to voicemail.
          </h2>
          <p className="text-lg text-muted mb-8">
            Try it free for 7 days. No charge until day 8. Cancel in 2 clicks from Settings.
          </p>
          <div className="flex flex-wrap justify-center gap-3 mb-3">
            <CtaPrimary href="/signup">Start free 7-day trial</CtaPrimary>
            <CtaSecondary href={BRAND.demoBookingUrl} external>
              Book a 15-min demo
            </CtaSecondary>
          </div>
          <p className="text-xs text-slate-500">
            {TRIAL_COPY.cardOnFile} · Works with Google Calendar today; Jobber and Housecall Pro
            coming soon.
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
      className="group inline-flex items-center gap-2 rounded-xl bg-brand-sheen text-white px-6 py-3.5 text-base font-semibold no-underline shadow-glow transition-all duration-300 hover:-translate-y-0.5 hover:shadow-card-hover"
    >
      {children}
      <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-0.5">→</span>
    </Link>
  );
}

function CtaSecondary({
  href,
  children,
  external,
}: {
  href: string;
  children: ReactNode;
  external?: boolean;
}): JSX.Element {
  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center rounded-xl border border-slate-300 bg-white/80 backdrop-blur text-ink px-6 py-3.5 text-base font-semibold no-underline transition-all duration-300 hover:border-accent/40 hover:-translate-y-0.5 hover:shadow-card"
      >
        {children}
      </a>
    );
  }
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
    <span className="inline-flex items-center gap-2 rounded-full bg-accent-soft text-accent text-[11px] font-semibold tracking-[0.16em] uppercase px-3 py-1 mb-4">
      <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      {children}
    </span>
  );
}
function SectionHeading({ children }: { children: ReactNode }): JSX.Element {
  return (
    <h2 className="font-display text-3xl sm:text-4xl font-semibold text-ink tracking-tight leading-[1.1] max-w-2xl">
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
    <div className="card-lift h-full rounded-2xl bg-white border border-slate-200/70 p-6 shadow-card">
      <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-sheen text-white mb-4 shadow-sm">
        {icon}
      </div>
      <p className="font-display text-base font-semibold text-ink mb-1.5">{title}</p>
      <p className="text-[13px] text-muted leading-relaxed">{body}</p>
    </div>
  );
}

function ProofStat({ num, label }: { num: string; label: string }): JSX.Element {
  return (
    <div className="card-lift rounded-2xl bg-white border border-slate-200/70 p-5 text-center shadow-card">
      <span className="block font-display text-4xl font-bold text-gradient tracking-tight">{num}</span>
      <span className="block text-xs text-muted mt-1.5">{label}</span>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }): JSX.Element {
  return (
    <li className="card-lift relative flex flex-col items-start rounded-2xl border border-slate-200/70 bg-white p-6 shadow-card">
      <div className="w-12 h-12 rounded-2xl bg-brand-sheen text-white font-display text-xl font-bold flex items-center justify-center mb-4 shadow-glow">
        {n}
      </div>
      <p className="font-display text-lg font-semibold text-ink mb-2">{title}</p>
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

function CompareRow({ label, a, b, c }: { label: string; a: string; b: string; c: string }): JSX.Element {
  return (
    <tr className="text-ink">
      <td className="px-3 py-3 font-medium align-top">{label}</td>
      <td className="px-3 py-3 text-muted align-top">{a}</td>
      <td className="px-3 py-3 text-muted align-top">{b}</td>
      <td className="px-3 py-3 align-top bg-accent/5">{c}</td>
    </tr>
  );
}

function SmsMockup(): JSX.Element {
  return (
    <div className="relative max-w-sm mx-auto lg:mx-0 w-full">
      <div className="rounded-2xl bg-white border border-slate-200 shadow-lg p-5 space-y-3">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-accent/10 text-accent text-xs font-semibold flex items-center justify-center">
              SP
            </div>
            <div>
              <p className="text-[13px] font-medium text-ink leading-none">Sanders Plumbing</p>
              <p className="text-[11px] text-muted mt-0.5">+1 (415) 555-9387</p>
            </div>
          </div>
          <span className="text-[11px] text-emerald-600 font-medium">● Live</span>
        </div>

        <Bubble side="left" time="11:02 PM">
          Hi! Saw you tried Sanders Plumbing — they&apos;re on another emergency. I can get you on
          their schedule. What&apos;s going on? (Reply STOP to opt out.)
        </Bubble>
        <Bubble side="right" time="11:02 PM">
          Pipe burst under my kitchen sink. Water everywhere.
        </Bubble>
        <Bubble side="left" time="11:02 PM">
          Got it — that&apos;s an emergency. Have you shut off the main water valve? I&apos;m
          flagging Mike right now.
        </Bubble>
        <Bubble side="right" time="11:03 PM">
          Yes, water&apos;s off. How fast can he get here?
        </Bubble>
        <Bubble side="left" time="11:03 PM" success>
          Mike will be there 11:45 PM tonight. $75 emergency callout secured. He&apos;ll bring
          standard repair parts.
        </Bubble>
      </div>
      <div className="absolute -bottom-3 right-6 bg-emerald-600 text-white text-xs font-medium px-3 py-1 rounded-full shadow">
        Emergency booked in 60 seconds
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

function AppointmentEmailMockup(): JSX.Element {
  return (
    <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 text-[11px] text-muted">
        <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-400"></span>
        <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400"></span>
        <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
        <span className="ml-2 font-medium text-ink">New booking · Sanders Plumbing</span>
      </div>
      <div className="px-4 py-3 text-[13px] text-ink space-y-2">
        <div className="flex justify-between">
          <span className="text-muted">Caller</span>
          <span className="font-medium">Erin H. · (415) ···-9111</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">When</span>
          <span className="font-medium">Today 11:45 PM (90 min)</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Job</span>
          <span className="font-medium">Burst pipe — kitchen, water off</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Likely parts</span>
          <span className="font-medium">½″ copper fitting, shark-bite</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Quoted</span>
          <span className="font-medium">$75 callout + $180–$320 repair</span>
        </div>
        <div className="flex justify-between border-t border-slate-200 pt-2">
          <span className="text-muted">Deposit</span>
          <span className="font-medium text-emerald-700">$75 secured · payout to your Stripe</span>
        </div>
      </div>
    </div>
  );
}

function DashboardMockup(): JSX.Element {
  return (
    <div className="card-lift rounded-2xl border border-slate-200/70 bg-white overflow-hidden shadow-card">
      <div className="border-b border-slate-200 px-4 py-3 flex items-center gap-2 text-xs text-muted">
        <span className="font-semibold text-ink">Dashboard</span>
        <span>·</span>
        <span>Upcoming appointments</span>
      </div>
      <div className="divide-y divide-slate-100 text-[13px]">
        {[
          { who: 'Erin H.', when: 'Tonight 11:45 PM', job: 'Burst pipe — kitchen', fee: '$75 deposit', tone: 'emergency' as const },
          { who: 'Mark D.', when: 'Tue 8:30 AM', job: 'Water heater — no hot water', fee: '$50 deposit', tone: 'normal' as const },
          { who: 'Priya R.', when: 'Tue 1:00 PM', job: 'Bathroom fixture install', fee: 'No deposit', tone: 'normal' as const },
          { who: 'Joe T.', when: 'Wed 10:00 AM', job: 'Slow drain — bathroom sink', fee: '$25 deposit', tone: 'normal' as const },
        ].map((row) => (
          <div key={row.who} className="px-4 py-3 flex items-center gap-3">
            <div
              className={`w-2 h-2 rounded-full ${row.tone === 'emergency' ? 'bg-red-500' : 'bg-emerald-500'}`}
              aria-hidden="true"
            />
            <div className="flex-1">
              <p className="font-medium text-ink">{row.who}</p>
              <p className="text-xs text-muted">{row.job}</p>
            </div>
            <div className="text-right">
              <p className="text-ink">{row.when}</p>
              <p className="text-xs text-muted">{row.fee}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-200 bg-slate-50 px-4 py-2 text-[11px] text-muted">
        4 booked this week · $225 in deposits secured
      </div>
    </div>
  );
}

function JobBriefMockup(): JSX.Element {
  return (
    <div className="card-lift rounded-2xl border border-slate-200/70 bg-white overflow-hidden shadow-card">
      <div className="border-b border-slate-200 px-4 py-3 flex items-center gap-2 text-xs text-muted">
        <span className="font-semibold text-ink">Job brief email</span>
        <span>·</span>
        <span>Sent to your inbox after every booking</span>
      </div>
      <div className="px-4 py-4 text-[13px] text-ink space-y-3">
        <div>
          <p className="text-xs text-muted">Subject</p>
          <p className="font-medium">New emergency · Burst pipe · Erin H. · Tonight 11:45 PM</p>
        </div>
        <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] text-amber-900">
          ⚠ Emergency keyword detected: <strong>burst pipe</strong>. Caller text-alerted to your
          mobile.
        </div>
        <ul className="space-y-1.5 text-[12px]">
          <li><strong>Service area:</strong> 94110 (in your zone)</li>
          <li><strong>Urgency:</strong> Same-night, water shut off</li>
          <li><strong>Owner / tenant:</strong> Owner-occupied</li>
          <li><strong>Job details:</strong> Pipe burst under kitchen sink, ½″ copper, no visible mold</li>
          <li><strong>AI quoted:</strong> $75 callout + $180–$320 repair (in your standard range)</li>
          <li><strong>Deposit:</strong> $75 paid · Stripe payout to you on next cycle</li>
        </ul>
        <p className="text-[11px] text-muted pt-2 border-t border-slate-200">
          Conversation transcript and customer contact attached. Reply STOP to opt out.
        </p>
      </div>
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
function IconShield(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
