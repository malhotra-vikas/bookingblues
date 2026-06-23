import type { Metadata } from 'next';

import { BRAND } from '../../../lib/brand';

export const metadata: Metadata = {
  title: 'SMS Messaging Program — KeeprSteady',
  description:
    'How KeeprSteady sends text messages on behalf of home-service contractors: consumer-initiated opt-in, message frequency, rates, and how to get HELP or STOP.',
  alternates: { canonical: '/messaging' },
};

/**
 * Public, self-contained description of the SMS program and its opt-in flow.
 * Written to be read by an A2P 10DLC carrier reviewer (addresses error 30909 —
 * "verify how end users consent"). Cite this URL in the campaign Message Flow.
 */
export default function MessagingProgramPage(): JSX.Element {
  return (
    <article className="px-6 py-12 max-w-3xl mx-auto">
      <header>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-ink">
          SMS Messaging Program
        </h1>
        <p className="mt-2 text-sm text-muted">
          How and why {BRAND.name} sends text messages, and how consumers consent to receive them.
        </p>
      </header>

      <aside className="mt-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-5 py-4 text-[14px] text-muted">
        <p className="font-semibold text-ink dark:text-slate-100">
          Summary for carrier / A2P 10DLC reviewers
        </p>
        <ul className="mt-2 list-disc pl-5 space-y-1">
          <li>
            <strong>Opt-in methods:</strong> (1) a consumer-initiated phone call followed by a verbal
            (IVR) disclosure on that same call, and (2) an explicit web opt-in form at{' '}
            <a href="/messaging/opt-in" className="underline">keeprsteady.com/messaging/opt-in</a>{' '}
            (name, mobile number, and an unchecked-by-default consent checkbox). No purchased or
            rented lists, and no third-party data.
          </li>
          <li>
            <strong>Consent proof:</strong> this page plus the{' '}
            <a href="/messaging/opt-in" className="underline">opt-in form</a>. The spoken greeting and
            the first text message quoted below are the <strong>exact, verbatim</strong> verbiage
            used in production.
          </li>
          <li>
            <strong>Message type:</strong> one-to-one, conversational customer care — not marketing,
            promotional, or bulk.
          </li>
        </ul>
      </aside>

      <Section title="Program name & operator">
        <p>
          <strong>Program:</strong> {BRAND.name} Appointment Booking. {BRAND.name} is operated by
          Malhotra Consultants LLC and provides an AI text-messaging assistant to independent
          home-service contractors (plumbing, HVAC, electrical, roofing, garage door).
        </p>
        <p>
          Messages are sent <strong>by the contractor&apos;s business</strong>, from that
          business&apos;s own dedicated number, to a person who just called that business.
        </p>
      </Section>

      <Section title="How consumers opt in (consent)">
        <p>
          Consent is established by a <strong>consumer-initiated phone call</strong>. There is no
          marketing list, and no number is ever purchased, rented, shared, or sold. A consumer
          receives a text only after they themselves call the business. The flow:
        </p>
        <ol className="list-decimal pl-6 space-y-1.5">
          <li>A consumer dials a contractor&apos;s published business phone number.</li>
          <li>
            If the call is unanswered or busy, the contractor&apos;s carrier conditionally forwards
            it to the contractor&apos;s dedicated {BRAND.name} number.
          </li>
          <li>
            Before any text is sent, the caller hears this <strong>exact</strong> spoken greeting
            (the business name is the contractor&apos;s own):
            <span className="mt-1.5 block rounded bg-slate-100 dark:bg-slate-800 px-3 py-2 font-mono text-[13px]">
              &ldquo;Thanks for calling [business name]. They are with another customer right now. We
              will send you a text message to help get you scheduled. Message and data rates may
              apply.&rdquo;
            </span>
          </li>
          <li>
            {BRAND.name} then sends an initial SMS to the exact number the consumer called from, to
            help schedule the service they were calling about. The conversation continues only in
            response to the consumer&apos;s own replies.
          </li>
        </ol>
        <p>
          Because the consumer initiated contact and is told they will be texted, they have a clear,
          reasonable expectation of the message. These are one-to-one, conversational customer-care
          messages — not marketing.
        </p>
      </Section>

      <Section title="Sample messages">
        <p>
          Every conversation opens with this <strong>exact</strong> message, which identifies the
          business and carries the opt-out and rate disclosure (<code>[Business Name]</code> is
          replaced with the contractor&apos;s actual business name):
        </p>
        <p className="rounded bg-slate-100 dark:bg-slate-800 px-3 py-2 font-mono text-[13px]">
          Hi! Thanks for calling [Business Name]. What can we help with today? Reply here and
          we&apos;ll get you on the schedule. Reply STOP to opt out. Msg &amp; data rates may apply.
        </p>
        <p>A typical follow-up, sent only after the consumer replies:</p>
        <p className="rounded bg-slate-100 dark:bg-slate-800 px-3 py-2 font-mono text-[13px]">
          Got it — we can do Tuesday at 9am or 2pm. Which works better, and what&apos;s the service
          address?
        </p>
      </Section>

      <Section title="Message frequency & cost">
        <ul className="list-disc pl-6 space-y-1.5">
          <li>
            <strong>Frequency:</strong> varies — you generally receive messages only in direct
            response to your own replies while scheduling.
          </li>
          <li>
            <strong>Cost:</strong> {BRAND.name} does not charge you for messages.{' '}
            <strong>Message and data rates may apply</strong> per your mobile carrier.
          </li>
        </ul>
      </Section>

      <Section title="HELP and STOP">
        <ul className="list-disc pl-6 space-y-1.5">
          <li>
            Reply <strong>HELP</strong> to any message, or email{' '}
            <a href={`mailto:${BRAND.supportEmail}`} className="underline">{BRAND.supportEmail}</a>,
            for assistance.
          </li>
          <li>
            Reply <strong>STOP</strong> at any time to opt out. You&apos;ll get one confirmation and
            no further messages unless you call the business again.
          </li>
        </ul>
      </Section>

      <Section title="Privacy">
        <p>
          {BRAND.name} does not sell or share mobile numbers or SMS opt-in/consent information with
          third parties or affiliates for marketing. See our{' '}
          <a href="/privacy" className="underline">Privacy Policy</a> and{' '}
          <a href="/terms" className="underline">Terms of Service</a> (SMS Messaging Program
          section) for full details. Carriers are not liable for delayed or undelivered messages.
        </p>
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold text-ink dark:text-slate-100">{title}</h2>
      <div className="mt-3 text-[15px] text-muted leading-relaxed space-y-3 [&_ol]:space-y-1.5">
        {children}
      </div>
    </section>
  );
}
