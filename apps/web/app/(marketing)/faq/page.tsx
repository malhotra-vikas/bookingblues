import type { Metadata } from 'next';

import { JsonLd } from '../../../components/JsonLd';
import { BRAND } from '../../../lib/brand';
import { getPlanPrices, usd } from '../../../lib/plans';

export const metadata: Metadata = {
  title: 'FAQ — KeeprSteady',
  description:
    'How does AI call recovery work? What about emergencies? Pricing, deposits, trade support, and your data — your questions answered.',
  alternates: { canonical: '/faq' },
};

export default async function FaqPage(): Promise<JSX.Element> {
  const prices = await getPlanPrices();
  const items: Array<{ q: string; a: string }> = [
    {
      q: 'Does KeeprSteady work for HVAC, roofing, and electrical — not just plumbing?',
      a: 'Yes. During onboarding you set your trade type, service area, job types, and the questions the AI should ask. An HVAC bot asks about system age and whether the issue is heating or cooling. A roofing bot asks about storm damage vs standard replacement. An electrical bot asks about sparks, burning smell, and whether the breaker tripped.',
    },
    {
      q: "What if the AI gives my customer wrong information?",
      a: `Every conversation is monitored in real time by our team. If the AI missteps — wrong price estimate, wrong time slot, or anything else — a human steps in and corrects it before it lands on your calendar. You also receive a full transcript after every interaction so you can review exactly what was said. If an error slips through, contact us at ${BRAND.salesEmail} and we will make it right.`,
    },
    {
      q: "What if the AI tries to book a job I can't take?",
      a: "It can only book inside the business hours and service-area ZIPs you set in onboarding, and only on free slots in your actual Google Calendar — so it physically can't double-book or schedule outside your hours. Every appointment is 90 minutes by default to leave drive-time padding. You can cancel any appointment from the dashboard, and the caller is automatically notified.",
    },
    {
      q: 'What if a caller asks for a service I do not offer?',
      a: "During onboarding you tell the AI exactly what trade type and job types you handle (residential vs commercial, install vs repair, etc.). If a caller asks about work outside your scope, the bot declines politely and ends the conversation — it will not book a job you would have to refuse later. Out-of-scope handoff messages are logged so you can see what you turned away.",
    },
    {
      q: 'How long does setup take?',
      a: 'Most contractors are live in under 30 minutes. Call forwarding takes 60 seconds (we give you the exact carrier code). Google Calendar connects via OAuth in 2 minutes. The onboarding wizard for trade, ZIPs, hours, and deposit amount takes 10–20 minutes.',
    },
    {
      q: 'How does the missed-call forwarding work?',
      a: `Your cell carrier supports conditional forwarding (a short code you dial). When you do not answer or your line is busy, the call goes to your ${BRAND.name} number, which immediately texts the caller. We show you the exact code for Verizon, AT&T, T-Mobile, and US Cellular in the onboarding wizard. Setup takes 60 seconds.`,
    },
    {
      q: 'What about real emergencies — burst pipes, gas smells?',
      a: "If a caller texts emergency keywords (burst pipe, no water, sewage backup, gas smell, carbon monoxide, no heat, no AC at extreme temperatures, sparks, exposed wires, flooding) the bot immediately SMSes your personal phone with the caller's number so you can call them back in 30 seconds. The bot keeps the conversation going in parallel until you take over — you do not have to choose between speed and AI assist.",
    },
    {
      q: 'Does it work with Jobber or Housecall Pro?',
      a: `Google Calendar is live today. Jobber and Housecall Pro integrations are in active development — appointments will sync automatically to your dispatch software. ServiceTitan is on the roadmap after that. If you are on one of these already, you can still use ${BRAND.name} today via the Google Calendar sync.`,
    },
    {
      q: 'How do plans and pricing work?',
      a: `Solo ${usd(prices.solo.monthlyUsd)}/mo includes 80 AI conversations/mo; deposit collection is off by default and you can enable it anytime (KeeprSteady adds 10% on top, charged to the customer). Crew ${usd(prices.crew.monthlyUsd)}/mo includes 500 conversations; deposit is on by default and can be disabled in onboarding (we add 15% on top); overages are billed at $15 per 50 additional conversations. Fleet ${usd(prices.fleet.monthlyUsd)}/mo includes 1,500 conversations; deposit collection is mandatory at this tier (we add 20% on top); overages same as Crew. Annual billing saves you 2 months on every plan.`,
    },
    {
      q: 'How do overages work on Crew and Fleet?',
      a: 'Once you exceed your monthly conversation limit, overages are billed in batches of 50 conversations at $15 per batch. You will get an email alert at 80% of your limit. Overages appear on your next monthly invoice.',
    },
    {
      q: 'Is the booking deposit required?',
      a: 'On Solo, deposit is off by default — enable it anytime in settings. On Crew, deposit is on by default but can be disabled in onboarding with one toggle (your dashboard will show estimated revenue forfeited if you turn it off). On Fleet, deposit is mandatory and cannot be disabled. You always set your own deposit amount and receive 100% of it. KeeprSteady adds a platform fee on top (15% Solo, 12% Crew, 10% Fleet — the fee drops as you scale) charged to the customer via a single Stripe transaction — we never touch your funds.',
    },
    {
      q: 'What does the AI do if it cannot book?',
      a: 'If your calendar is full, the caller is outside your service area, or the job type is out of scope, the AI politely declines and ends the conversation. Declined conversations are logged in your dashboard so you can see what volume you are turning away.',
    },
    {
      q: 'What happens when my free trial ends?',
      a: 'Your card is charged on day 8 at your plan rate. You will receive an email reminder on day 6. Cancel before day 8 and you will not be charged. Your number is released after a 7-day grace period post-cancellation.',
    },
    {
      q: 'Where does my customer data live?',
      a: `Postgres on Supabase, with row-level security so other subscribers on the platform can never see your data. Twilio holds the phone numbers, Google holds the calendar, Stripe holds the cards. ${BRAND.name} holds the conversation transcripts and appointment metadata only.`,
    },
    {
      q: 'Can I cancel?',
      a: 'Yes — in 2 clicks from Settings → Billing. No email, no phone call, no minimum term. Your number is released after a 7-day grace period in case you change your mind.',
    },
  ];
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  };
  return (
    <div className="px-6 py-12 max-w-2xl mx-auto">
      <JsonLd data={faqJsonLd} />
      <h1 className="text-3xl font-semibold">FAQ</h1>
      <p className="mt-2 text-muted text-sm">
        Still have questions? <a href={`mailto:${BRAND.salesEmail}`} className="underline">{BRAND.salesEmail}</a> or{' '}
        <a href={BRAND.demoBookingUrl} target="_blank" rel="noopener noreferrer" className="underline">
          book a 15-min demo
        </a>
        .
      </p>
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
