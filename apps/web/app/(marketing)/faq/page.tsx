export default function FaqPage(): JSX.Element {
  const items: Array<{ q: string; a: string }> = [
    {
      q: 'How does the missed-call forwarding work?',
      a: "Your phone carrier supports conditional forwarding (a code you dial). When you don't answer or your line is busy, the call goes to your BookingBlues Twilio number, which immediately texts the caller. Carrier-specific instructions are shown in the onboarding wizard.",
    },
    {
      q: 'Can the bot handle out-of-trade calls?',
      a: "No — that's intentional. The bot is scoped to your trade category. If someone calls your plumbing line about lawn care, it politely declines and ends the conversation.",
    },
    {
      q: 'Do you charge per call?',
      a: "We don't charge usage fees on top of your subscription. You optionally collect a small non-refundable booking fee from the caller; we take a small platform cut on those (10% by default).",
    },
    {
      q: 'Where does my customer data live?',
      a: 'Postgres on Supabase, with row-level security. Twilio holds the phone numbers, Google holds the calendar, Stripe holds the cards. We hold the conversation transcripts and appointment metadata.',
    },
    {
      q: 'Can I cancel?',
      a: 'Yes — anytime, from Settings → Billing. Your number is released after a 7-day grace period.',
    },
  ];
  return (
    <div className="px-6 py-12 max-w-2xl mx-auto">
      <h1 className="text-3xl font-semibold">FAQ</h1>
      <dl className="mt-8 space-y-6">
        {items.map((item) => (
          <div key={item.q} className="border-t pt-4">
            <dt className="font-medium">{item.q}</dt>
            <dd className="mt-2 text-sm text-muted">{item.a}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
