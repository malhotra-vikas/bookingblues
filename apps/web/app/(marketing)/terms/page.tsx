import type { Metadata } from 'next';

import { BRAND } from '../../../lib/brand';

export const metadata: Metadata = {
  title: 'Terms of Service — KeeprSteady',
  description:
    'Subscription terms, billing, deposit pass-through structure, TCPA compliance, and dispute resolution for KeeprSteady.',
  alternates: { canonical: '/terms' },
};

export default function TermsPage(): JSX.Element {
  return (
    <article className="px-6 py-12 max-w-3xl mx-auto">
      <header>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-ink">
          Terms of Service
        </h1>
        <p className="mt-2 text-sm text-muted">
          Effective Date: May 26, 2026 · Governing Law: State of Florida
        </p>
      </header>

      <Section title="1. Acceptance of Terms">
        <p>
          By creating an account, starting a free trial, or using any part of the {BRAND.name}{' '}
          platform (&ldquo;Service&rdquo;), you (&ldquo;Subscriber&rdquo;) agree to be bound by
          these Terms of Service (&ldquo;Terms&rdquo;). If you are using the Service on behalf of
          a business, you represent that you have authority to bind that business to these Terms.
        </p>
        <p>If you do not agree to these Terms, do not use the Service.</p>
      </Section>

      <Section title="2. Description of Service">
        <p>
          {BRAND.name} provides an AI-powered SMS booking and dispatch assistant for home service
          contractors. The Service includes:
        </p>
        <ul>
          <li>A dedicated Twilio phone number that receives calls forwarded by the Subscriber</li>
          <li>An AI assistant that texts back missed callers and books appointments</li>
          <li>Google Calendar integration for appointment scheduling</li>
          <li>Optional non-refundable booking deposit collection via Stripe</li>
          <li>Human-in-the-loop monitoring by {BRAND.name} staff</li>
          <li>Metadata summary emails after each interaction</li>
        </ul>
      </Section>

      <Section title="3. Subscription Plans and Billing">
        <h3>3a. Plan Tiers</h3>
        <p>{BRAND.name} offers three subscription tiers:</p>
        <ul>
          <li>
            <strong>Solo — $49/month:</strong> Up to 80 AI conversations/mo. Optional deposit
            collection (10% platform fee).
          </li>
          <li>
            <strong>Crew — $650/month:</strong> Up to 500 AI conversations/mo. Deposit collection
            on by default, disableable in onboarding. Subscriber sets deposit amount and receives
            100% of it; {BRAND.name} adds 15% on top charged to the End User via Stripe Connect
            application fee. Overages billed at $15 per 50 additional conversations.
          </li>
          <li>
            <strong>Fleet — $1,499/month:</strong> Up to 1,500 AI conversations/mo. Deposit
            collection is mandatory and cannot be disabled. Subscriber sets deposit amount and
            receives 100% of it; {BRAND.name} adds 20% on top charged to the End User via Stripe
            Connect application fee. Overages billed at $15 per 50 additional conversations.
          </li>
        </ul>
        <h3>3b. Free Trial</h3>
        <p>
          New Subscribers receive a 7-day free trial. A valid payment method is required to start
          the trial. You will not be charged if you cancel before the trial period ends. If you
          do not cancel, your subscription begins automatically on day 8.
        </p>
        <h3>3c. Billing Cycle</h3>
        <p>
          Subscriptions are billed monthly on the anniversary of your trial end date. Annual
          billing is available at a discount — contact {BRAND.salesEmail} for annual pricing or
          select the annual cadence at signup.
        </p>
        <h3>3d. Deposit Fees and Pass-Through Structure</h3>
        <p>
          {BRAND.name} uses Stripe Connect to facilitate booking deposits. {BRAND.name} does not
          hold, pool, store, or take custody of deposit funds at any point. The payment flow is
          as follows:
        </p>
        <ul>
          <li>
            The End User is presented with a single combined charge at booking: the
            Subscriber&apos;s deposit amount plus {BRAND.name}&apos;s platform fee.
          </li>
          <li>
            Stripe processes the combined charge and immediately routes the Subscriber&apos;s
            deposit portion directly to the Subscriber&apos;s connected Stripe account via
            Stripe Connect&apos;s <code>application_fee_amount</code> mechanism.
          </li>
          <li>
            {BRAND.name}&apos;s platform fee (10% on Solo, 15% on Crew, 20% on Fleet) is
            collected by Stripe as an application fee and routed to {BRAND.name}&apos;s Stripe
            account within the same transaction.
          </li>
          <li>
            {BRAND.name} never holds, transfers, pools, or has custody of the Subscriber&apos;s
            deposit funds at any stage of the transaction.
          </li>
          <li>
            The Subscriber is the merchant of record for the deposit portion of the transaction.
            {' '}{BRAND.name} is the merchant of record only for its own platform fee portion.
          </li>
        </ul>
        <p>
          Because {BRAND.name} operates as a pass-through platform via Stripe Connect and does
          not take custody of funds, {BRAND.name} is not acting as a payment facilitator, money
          transmitter, or financial intermediary with respect to Subscriber deposits.{' '}
          {BRAND.name}&apos;s platform fee is a software service charge, not a payment processing
          fee.
        </p>
        <p>
          Subscribers are responsible for ensuring their use of deposit collection complies with
          applicable state contractor licensing laws, consumer protection statutes, and any
          trade-specific regulations governing advance payments in their jurisdiction.
        </p>
        <h3>3e. Overages</h3>
        <p>
          On Crew and Fleet plans, conversations exceeding the monthly limit are billed in
          batches of 50 conversations at $15 per batch. Overage charges are added to the
          following month&apos;s invoice. {BRAND.name} will notify Subscribers by email when they
          reach 80% of their monthly conversation limit.
        </p>
        <h3>3f. Price Changes</h3>
        <p>
          {BRAND.name} reserves the right to change subscription prices with 30 days written
          notice to active Subscribers. Price changes take effect at the next billing cycle after
          the notice period.
        </p>
      </Section>

      <Section title="4. Cancellation and Refunds">
        <ul>
          <li>
            Subscribers may cancel at any time from Settings → Billing within the dashboard.
          </li>
          <li>
            Cancellation takes effect at the end of the current billing period. You retain full
            access until that date.
          </li>
          <li>Your Twilio number is released after a 7-day grace period following cancellation.</li>
          <li>
            {BRAND.name} does not issue refunds for partial months, unused conversations, or
            deposit fees already collected.
          </li>
          <li>
            Refund exceptions may be considered at {BRAND.name}&apos;s sole discretion for
            documented service outages exceeding 24 hours.
          </li>
        </ul>
        <h3>4a. Deposits In-Flight at Cancellation</h3>
        <p>
          Because {BRAND.name} uses Stripe Connect and does not hold Subscriber funds, deposit
          transactions already processed at cancellation are unaffected. Those funds route
          directly to the Subscriber&apos;s connected Stripe account per Stripe&apos;s standard
          payout schedule, which {BRAND.name} does not control. {BRAND.name} has no ability to
          hold, reverse, or redirect deposit funds once a Stripe Connect transaction is
          processed.
        </p>
        <p>
          Subscribers are responsible for any deposit refunds owed to End Users for appointments
          that cannot be honored after account cancellation. {BRAND.name}&apos;s platform fee
          portion of a processed transaction is non-refundable once booking is confirmed.
        </p>
        <h3>4b. End User Deposit Refunds</h3>
        <p>
          If an End User is entitled to a deposit refund (for example, because the Subscriber
          cancelled the appointment), the refund is the sole responsibility of the Subscriber.
          Because the Subscriber is the merchant of record for the deposit portion, refunds must
          be initiated by the Subscriber through their connected Stripe account or directly with
          the End User. {BRAND.name} has no obligation to issue, fund, or facilitate deposit
          refunds on behalf of Subscribers. {BRAND.name}&apos;s platform fee is non-refundable in
          all circumstances, as it represents compensation for the AI booking service already
          rendered.
        </p>
        <p>
          Subscribers should maintain a clear refund policy for their customers and communicate
          it during the booking process. Some states have specific requirements for contractor
          deposit refunds — consult a licensed attorney for guidance applicable to your
          jurisdiction.
        </p>
      </Section>

      <Section title="5. Subscriber Responsibilities">
        <p>By using {BRAND.name}, you agree to:</p>
        <ul>
          <li>
            Comply with all applicable laws, including the Telephone Consumer Protection Act
            (TCPA), CAN-SPAM Act, and Florida consumer protection statutes
          </li>
          <li>
            Ensure your customers have a reasonable expectation of receiving automated SMS
            messages when they call your business number
          </li>
          <li>
            Include STOP opt-out language in your AI&apos;s first message ({BRAND.name} does this
            by default — do not disable it)
          </li>
          <li>
            Set accurate business hours, service areas, and deposit amounts during onboarding
          </li>
          <li>Not use the Service for any unlawful, deceptive, or harassing communications</li>
          <li>
            Not attempt to reverse-engineer, scrape, or replicate the {BRAND.name} platform
          </li>
          <li>Maintain the confidentiality of your account credentials</li>
        </ul>
      </Section>

      <Section title="6. TCPA Compliance">
        <p>
          {BRAND.name}&apos;s AI texts consumers who have called your business number. This
          constitutes a reasonable expectation of automated response. However, you as the
          Subscriber are responsible for ensuring your use of the Service complies with the TCPA
          and any applicable state telemarketing laws. {BRAND.name} provides STOP opt-out
          functionality in all outbound messages by default. You must not disable this feature.
        </p>
        <p>
          {BRAND.name} is not a law firm and this is not legal advice. If you have specific TCPA
          compliance questions, consult a licensed attorney.
        </p>
      </Section>

      <Section title="7. Human-in-the-Loop Monitoring">
        <p>
          {BRAND.name} staff monitor AI conversations in real time for quality assurance. By
          using the Service, you consent to this monitoring. {BRAND.name} staff may intervene to
          correct AI errors before they affect your customers. This monitoring is a feature, not
          a guarantee — {BRAND.name} does not warrant that every conversation will be reviewed
          before completion.
        </p>
      </Section>

      <Section title="8. Intellectual Property">
        <ul>
          <li>{BRAND.name} retains all rights to the platform, AI models, software, and branding.</li>
          <li>
            Subscribers retain ownership of their business data, customer information, and
            conversation content.
          </li>
          <li>
            By using the Service, Subscribers grant {BRAND.name} a limited license to process
            their data as necessary to deliver the Service and, in anonymized/aggregated form, to
            improve the AI models.
          </li>
        </ul>
      </Section>

      <Section title="9. Disclaimer of Warranties">
        <p className="uppercase text-[13px] tracking-wide">
          THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; WITHOUT
          WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF
          MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT. {BRAND.name.toUpperCase()}{' '}
          DOES NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR THAT THE AI
          WILL BOOK EVERY CALL OR PRODUCE ACCURATE RESULTS IN EVERY CASE.
        </p>
      </Section>

      <Section title="10. Limitation of Liability">
        <p className="uppercase text-[13px] tracking-wide">
          TO THE MAXIMUM EXTENT PERMITTED BY FLORIDA LAW, {BRAND.name.toUpperCase()}&apos;S TOTAL
          LIABILITY TO ANY SUBSCRIBER FOR ANY CLAIMS ARISING OUT OF OR RELATING TO THESE TERMS OR
          THE SERVICE SHALL NOT EXCEED THE TOTAL SUBSCRIPTION FEES PAID BY THAT SUBSCRIBER IN THE
          3 MONTHS PRECEDING THE CLAIM.
        </p>
        <p className="uppercase text-[13px] tracking-wide">
          {BRAND.name.toUpperCase()} IS NOT LIABLE FOR: LOST REVENUE OR PROFITS, MISSED JOBS,
          CUSTOMER DISPUTES ARISING FROM AI CONVERSATIONS, TWILIO OR STRIPE SERVICE OUTAGES, OR
          ANY INDIRECT, INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES.
        </p>
      </Section>

      <Section title="11. Indemnification">
        <p>
          You agree to indemnify and hold harmless {BRAND.name}, its officers, employees, and
          agents from any claims, damages, or expenses (including reasonable attorney&apos;s
          fees) arising from: (a) your use of the Service in violation of these Terms; (b) your
          violation of any applicable law including the TCPA; or (c) any dispute between you and
          an End User.
        </p>
      </Section>

      <Section title="12. Governing Law and Dispute Resolution">
        <p>
          These Terms are governed by the laws of the State of Florida, without regard to
          conflict of law principles. Any dispute arising from these Terms shall be resolved by
          binding arbitration in Polk County, Florida, under the rules of the American
          Arbitration Association (AAA), except that either party may seek injunctive relief in a
          court of competent jurisdiction. You waive any right to a jury trial or to participate
          in a class action.
        </p>
      </Section>

      <Section title="13. Modifications to Terms">
        <p>
          {BRAND.name} may modify these Terms at any time. We will notify active Subscribers by
          email at least 14 days before material changes take effect. Continued use of the
          Service after that date constitutes acceptance of the modified Terms. The current
          version is always available at {BRAND.domain}/terms.
        </p>
      </Section>

      <Section title="14. Termination">
        <p>
          {BRAND.name} reserves the right to suspend or terminate any account, with or without
          notice, for violation of these Terms, suspected fraud, abuse of the platform, or
          non-payment. Upon termination, your access to the Service ceases immediately. Sections
          8–12 survive termination.
        </p>
      </Section>

      <Section title="15. Contact">
        <p>
          {BRAND.name}
          <br />
          Email: <a href={`mailto:${BRAND.salesEmail}`} className="underline">{BRAND.salesEmail}</a>
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
      <div className="mt-3 text-[15px] text-muted leading-relaxed space-y-3 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-ink [&_h3]:dark:text-slate-100 [&_h3]:mt-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1.5 [&_code]:font-mono [&_code]:text-[13px] [&_code]:bg-slate-100 [&_code]:dark:bg-slate-800 [&_code]:px-1 [&_code]:rounded">
        {children}
      </div>
    </section>
  );
}
