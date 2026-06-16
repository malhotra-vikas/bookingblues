import type { Metadata } from 'next';

import { BRAND, TERMS } from '../../../lib/brand';

export const metadata: Metadata = {
  title: 'Privacy Policy — KeeprSteady',
  description:
    'How KeeprSteady collects, uses, retains, and protects information from contractors and end users.',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage(): JSX.Element {
  return (
    <article className="px-6 py-12 max-w-3xl mx-auto prose-styles">
      <header>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-ink">
          Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-muted">
          Effective Date: {TERMS.effectiveDate} · Governing Law: State of Florida
        </p>
      </header>

      <Section title="1. Who We Are">
        <p>
          {BRAND.name} (&ldquo;{BRAND.name},&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or
          &ldquo;our&rdquo;) is a Florida-based software company that provides an AI-powered
          booking and dispatch assistant for home service professionals, including plumbers, HVAC
          technicians, roofers, and electricians. Our service enables contractors to recover
          missed calls via automated SMS conversations and book appointments on their behalf.
        </p>
        <p>
          Contact: <a href={`mailto:${BRAND.salesEmail}`}>{BRAND.salesEmail}</a>
        </p>
      </Section>

      <Section title="2. Scope of This Policy">
        <p>This Privacy Policy applies to:</p>
        <ul>
          <li>
            Contractors and businesses who subscribe to {BRAND.name} (&ldquo;Subscribers&rdquo;)
          </li>
          <li>
            End consumers who interact with {BRAND.name}&apos;s AI via SMS on behalf of a
            Subscriber (&ldquo;End Users&rdquo;)
          </li>
          <li>Visitors to {BRAND.domain} and all associated subdomains</li>
        </ul>
        <p>
          By using our service or website, you agree to the collection and use of information as
          described in this policy.
        </p>
      </Section>

      <Section title="3. Information We Collect">
        <h3>3a. Information Subscribers Provide</h3>
        <ul>
          <li>Full name, business name, email address, and phone number</li>
          <li>
            Google Calendar credentials (OAuth token — we access calendar data only to read/write
            appointments)
          </li>
          <li>
            Stripe payment information (we do not store raw card numbers — Stripe is the merchant
            processor)
          </li>
          <li>Business configuration: service area ZIP codes, business hours, job types, deposit amounts</li>
        </ul>
        <h3>3b. Information Collected Automatically from End Users</h3>
        <p>When a consumer texts your {BRAND.name} number, we collect:</p>
        <ul>
          <li>Their phone number (provided by Twilio)</li>
          <li>The full content of the SMS conversation</li>
          <li>Timestamps and message metadata</li>
          <li>
            Any personally identifying information they voluntarily provide during the
            conversation (name, address, ZIP code, issue description)
          </li>
        </ul>
        <h3>3c. Technical and Usage Data</h3>
        <ul>
          <li>IP addresses and browser/device type for website visitors</li>
          <li>Pages visited, referrer URLs, and session duration</li>
          <li>API call logs and error logs (no message content in error logs)</li>
        </ul>
      </Section>

      <Section title="4. How We Use Your Information">
        <p>We use collected information to:</p>
        <ul>
          <li>Operate the AI booking assistant and deliver the core service</li>
          <li>Send SMS conversations via Twilio on behalf of Subscribers</li>
          <li>Write appointments to Subscribers&apos; Google Calendars</li>
          <li>Process payments and booking deposits via Stripe</li>
          <li>Send Subscribers metadata summary emails after each interaction</li>
          <li>Monitor conversations for quality assurance and human-in-the-loop correction</li>
          <li>
            Detect and respond to emergency keywords (e.g., burst pipe, gas smell) and alert
            Subscribers
          </li>
          <li>Improve and train our AI models on anonymized, aggregated conversation patterns</li>
          <li>Comply with legal obligations</li>
        </ul>
        <p>
          We do not sell your personal information to third parties. We do not use End User data
          for advertising purposes.
        </p>
      </Section>

      <Section title="5. Third-Party Service Providers">
        <p>
          {BRAND.name} uses the following sub-processors. Each has their own privacy policy:
        </p>
        <ul>
          <li>
            <strong>Twilio</strong> (twilio.com) — SMS delivery and phone number management.
            Holds phone numbers and message delivery records.
          </li>
          <li>
            <strong>Supabase</strong> (supabase.com) — Database hosting (PostgreSQL with
            row-level security). Stores conversation transcripts and appointment metadata.
          </li>
          <li>
            <strong>Stripe</strong> (stripe.com) — Payment processing via Stripe Connect.
            Processes booking deposits as a pass-through: End User funds route directly to the
            Subscriber&apos;s connected Stripe account. {BRAND.name} collects only its platform
            fee via <code>application_fee_amount</code>. Holds payment card data and transaction
            records. {BRAND.name} does not hold or have custody of Subscriber deposit funds.
          </li>
          <li>
            <strong>Google</strong> (google.com) — Calendar integration via OAuth. Holds calendar
            access tokens.
          </li>
        </ul>
        <p>We do not share your data with any other third parties except as required by law.</p>
      </Section>

      <Section title="6. SMS and Text Messaging Consent">
        <p>
          When an End User calls a Subscriber&apos;s business number and the call is missed or
          forwarded to a {BRAND.name} number, {BRAND.name} sends automated SMS messages to that
          End User on the Subscriber&apos;s behalf to schedule and service the request. By placing
          the call and continuing the text conversation, the End User consents to receive these
          messages.
        </p>
        <p>
          <strong>
            We do not sell, rent, or share mobile phone numbers, SMS opt-in, or consent
            information with third parties or affiliates for their marketing or promotional
            purposes. Text-messaging originator opt-in data and consent are not shared with any
            third parties.
          </strong>{' '}
          Mobile information is used solely to deliver the booking conversation and is shared only
          with the sub-processors listed in Section 5 (such as Twilio) strictly to transmit those
          messages.
        </p>
        <p>
          Message frequency varies. Message and data rates may apply. End Users may reply{' '}
          <strong>HELP</strong> for help (or email{' '}
          <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>) and{' '}
          <strong>STOP</strong> at any time to opt out of further messages. See the SMS Messaging
          Program section of our <a href="/terms">Terms of Service</a> for full program details.
        </p>
      </Section>

      <Section title="7. Data Retention">
        <ul>
          <li>
            <strong>Conversation transcripts:</strong> retained for 12 months from the date of
            the conversation, then deleted.
          </li>
          <li>
            <strong>Appointment metadata:</strong> retained for the duration of your subscription
            plus 90 days after cancellation.
          </li>
          <li>
            <strong>Payment records:</strong> retained as required by Stripe and applicable tax
            law (typically 7 years).
          </li>
          <li>
            <strong>End User phone numbers:</strong> deleted from our systems within 30 days of
            the conversation, unless they are booked as an active appointment.
          </li>
          <li>
            <strong>Subscriber account data:</strong> deleted within 30 days of account
            cancellation upon written request to {BRAND.salesEmail}.
          </li>
          <li>
            <strong>SMS opt-out records (STOP replies):</strong> retained indefinitely as
            required by TCPA compliance. When an End User replies STOP, that opt-out is logged
            and honored for all future messages from the associated {BRAND.name} number. Opt-out
            records are never deleted, even after Subscriber account cancellation, to ensure
            continued compliance with federal opt-out requirements.
          </li>
        </ul>
      </Section>

      <Section title="8. Data Security">
        <p>We implement industry-standard security measures including:</p>
        <ul>
          <li>Encryption at rest and in transit (TLS 1.2+)</li>
          <li>
            Row-level security on our database (Supabase RLS) — no Subscriber can access another
            Subscriber&apos;s data
          </li>
          <li>OAuth 2.0 for Google Calendar access — we never store your Google password</li>
          <li>Stripe handles all payment card data — we never see or store raw card numbers</li>
        </ul>
        <p>
          No method of transmission over the internet is 100% secure. We cannot guarantee
          absolute security but are committed to protecting your data using commercially
          reasonable means.
        </p>
      </Section>

      <Section title="9. Your Rights (Florida / US)">
        <p>Under applicable US law, you have the right to:</p>
        <ul>
          <li>Request access to the personal information we hold about you</li>
          <li>Request correction of inaccurate information</li>
          <li>Request deletion of your personal information (subject to legal retention requirements)</li>
          <li>Opt out of AI model training using your conversation data</li>
        </ul>
        <p>
          To exercise any of these rights, email {BRAND.salesEmail} with the subject line
          &ldquo;Privacy Request.&rdquo; We will respond within 30 days.
        </p>
      </Section>

      <Section title="10. Children's Privacy">
        <p>
          {BRAND.name} is a B2B service intended for use by business owners and their customers.
          We do not knowingly collect personal information from children under the age of 13. If
          you believe a child has provided us with personal information, contact us immediately
          at {BRAND.salesEmail}.
        </p>
      </Section>

      <Section title="11. Changes to This Policy">
        <p>
          We may update this Privacy Policy from time to time. We will notify active Subscribers
          by email at least 14 days before any material change takes effect. Continued use of the
          service after that date constitutes acceptance of the updated policy. The current
          version is always available at {BRAND.domain}/privacy.
        </p>
      </Section>

      <Section title="12. Contact">
        <p>
          {BRAND.name}
          <br />
          Email: <a href={`mailto:${BRAND.salesEmail}`}>{BRAND.salesEmail}</a>
          <br />
          Website: {BRAND.domain}
        </p>
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold text-ink dark:text-slate-100">{title}</h2>
      <div className="mt-3 text-[15px] text-muted leading-relaxed space-y-3 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-ink [&_h3]:dark:text-slate-100 [&_h3]:mt-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1.5 [&_a]:underline [&_a]:text-accent [&_code]:font-mono [&_code]:text-[13px] [&_code]:bg-slate-100 [&_code]:dark:bg-slate-800 [&_code]:px-1 [&_code]:rounded">
        {children}
      </div>
    </section>
  );
}
