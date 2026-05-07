import Link from 'next/link';

export default function HomePage(): JSX.Element {
  return (
    <div>
      <section className="px-6 py-20 max-w-3xl mx-auto text-center">
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight">
          Never miss a job again.
        </h1>
        <p className="mt-5 text-lg text-muted">
          When a customer hits your voicemail, BookingBlues texts them right back, vets the job, and
          books it on your calendar — all while you&apos;re on the other line.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link
            href="/signup"
            className="rounded-md bg-accent px-5 py-3 text-white no-underline"
          >
            Start your 7-day free trial
          </Link>
          <Link
            href="/pricing"
            className="rounded-md border border-slate-300 px-5 py-3 no-underline"
          >
            See pricing
          </Link>
        </div>
      </section>

      <section className="px-6 pb-16 max-w-4xl mx-auto grid sm:grid-cols-3 gap-6">
        <Feature title="Reply in seconds" body="A Twilio number takes the call and texts the caller before they dial a competitor." />
        <Feature title="Vet, scope, book" body="Our AI bot stays in your trade — plumbing, HVAC, roofing, etc. — and only books real jobs." />
        <Feature title="Optional booking fee" body="Charge a non-refundable deposit via Stripe before confirming the slot." />
      </section>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }): JSX.Element {
  return (
    <div className="rounded-md border p-5">
      <div className="font-semibold">{title}</div>
      <p className="mt-2 text-sm text-muted">{body}</p>
    </div>
  );
}
