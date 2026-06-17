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
            The caller hears a brief greeting stating they will receive a text to get scheduled —
            for example: <em>&ldquo;Thanks for calling. Sorry we missed you — we&apos;ll text you
            right now to get you scheduled.&rdquo;</em> This disclosure happens before any SMS is
            sent.
          </li>
          <li>
            {BRAND.name} then sends a single SMS to the exact number the consumer called from, to
            help schedule the service they were calling about.
          </li>
        </ol>
        <p>
          Because the consumer initiated contact and is told they will be texted, they have a clear,
          reasonable expectation of the message. These are one-to-one, conversational customer-care
          messages — not marketing.
        </p>
      </Section>

      <Section title="First-message disclosure">
        <p>The first message in every conversation identifies the business and includes:</p>
        <p className="rounded bg-slate-100 dark:bg-slate-800 px-3 py-2 font-mono text-[13px]">
          Reply STOP to opt out, HELP for help. Msg &amp; data rates may apply.
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
