export default function FaqPage(): JSX.Element {
  const items: Array<{ q: string; a: string }> = [
    {
      q: "What if the AI tries to book a job I can't take?",
      a: "It can only book inside the business hours and service-area ZIPs you set in onboarding, and only on free slots in your actual Google Calendar — so it physically can't double-book or schedule outside your hours. Every appointment is 90 minutes by default to leave drive-time padding. You can cancel any appointment from the dashboard, and the caller is automatically notified.",
    },
    {
      q: 'What about commercial calls? I only do residential.',
      a: "The bot is plumbing-tuned but residential-default. You can tell it your specialty in onboarding. If a caller asks about commercial work outside your scope, the bot declines politely and ends the conversation — it won't book a job you'd have to refuse later. Out-of-scope handoff messages are logged so you can see what you turned away.",
    },
    {
      q: 'How does the missed-call forwarding work?',
      a: "Your cell carrier supports conditional forwarding (a short code you dial). When you don't answer or your line is busy, the call goes to your BookingBlues number, which immediately texts the caller. We show you the exact code for Verizon, AT&T, T-Mobile, and US Cellular in the onboarding wizard. Setup takes 60 seconds.",
    },
    {
      q: 'What about real emergencies — burst pipes, gas smells?',
      a: "If a caller texts emergency keywords (burst pipe, no water, sewage backup, gas smell, carbon monoxide, flooding) the bot immediately SMSes your personal phone with the caller's number so you can call them back in 30 seconds. The bot keeps the conversation going in parallel until you take over — you don't have to choose between speed and AI assist.",
    },
    {
      q: 'Does it work with Jobber or Housecall Pro?',
      a: "Google Calendar is live today. Jobber and Housecall Pro integrations are in active development — appointments will sync automatically to your dispatch software. ServiceTitan is on the roadmap after that. If you're on one of these already, you can still use BookingBlues today via the Google Calendar sync.",
    },
    {
      q: 'Do you charge per call?',
      a: "No usage fees on top of your $49/mo subscription. You optionally collect a small non-refundable booking fee from the caller (e.g. $25) — we take a 10% platform cut on those. The plumber is the merchant of record; we never touch the caller's money.",
    },
    {
      q: 'Where does my customer data live?',
      a: 'Postgres on Supabase, with row-level security so other plumbers on the platform can never see your data. Twilio holds the phone numbers, Google holds the calendar, Stripe holds the cards. We hold the conversation transcripts and appointment metadata only.',
    },
    {
      q: 'Can I cancel?',
      a: 'Yes — anytime, from Settings → Billing. Your number is released after a 7-day grace period in case you change your mind.',
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
