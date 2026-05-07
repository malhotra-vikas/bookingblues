import Link from 'next/link';

export default function PricingPage(): JSX.Element {
  return (
    <div className="px-6 py-12 max-w-3xl mx-auto">
      <h1 className="text-3xl font-semibold">Pricing</h1>
      <p className="mt-2 text-muted">
        Simple monthly subscription. 7-day free trial. Cancel anytime.
      </p>

      <div className="mt-10 grid sm:grid-cols-2 gap-4">
        <div className="rounded-md border p-6">
          <div className="text-sm uppercase tracking-wide text-muted">Starter</div>
          <div className="mt-2 text-3xl font-semibold">$49<span className="text-base text-muted">/mo</span></div>
          <ul className="mt-4 text-sm space-y-1">
            <li>One Twilio number</li>
            <li>AI booking assistant</li>
            <li>Google Calendar integration</li>
            <li>Optional booking fee via Stripe</li>
          </ul>
          <Link
            href="/signup"
            className="mt-6 inline-block rounded-md bg-accent px-4 py-2 text-white no-underline"
          >
            Start trial
          </Link>
        </div>
        <div className="rounded-md border p-6">
          <div className="text-sm uppercase tracking-wide text-muted">Pro</div>
          <div className="mt-2 text-3xl font-semibold">$149<span className="text-base text-muted">/mo</span></div>
          <ul className="mt-4 text-sm space-y-1">
            <li>Everything in Starter</li>
            <li>Higher message volume</li>
            <li>Priority support</li>
          </ul>
          <Link
            href="/signup"
            className="mt-6 inline-block rounded-md border border-slate-300 px-4 py-2 no-underline"
          >
            Start trial
          </Link>
        </div>
      </div>
    </div>
  );
}
