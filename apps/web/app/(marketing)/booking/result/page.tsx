import type { Metadata } from 'next';

import { BRAND } from '../../../../lib/brand';

export const metadata: Metadata = {
  title: `Booking — ${BRAND.name}`,
  robots: { index: false },
};

type Status = 'paid' | 'cancelled' | 'expired' | 'unavailable';

const COPY: Record<Status, { emoji: string; title: string; body: string }> = {
  paid: {
    emoji: '✅',
    title: "You're all set!",
    body: 'Payment received and your appointment is confirmed. We just texted you the details — see you then.',
  },
  cancelled: {
    emoji: '↩️',
    title: 'Payment cancelled',
    body: "No charge was made. Your time slot may still be held for a few more minutes — tap the link in your text to finish, or reply to that text to pick another time.",
  },
  expired: {
    emoji: '⌛',
    title: 'This link expired',
    body: "Your held time slot was released because the booking fee wasn't paid in time. Reply to your text and we'll find you another time.",
  },
  unavailable: {
    emoji: '🔎',
    title: "We couldn't find that booking",
    body: 'This payment link is no longer valid. Reply to your text message and we’ll help you get scheduled.',
  },
};

export default async function BookingResultPage({
  searchParams,
}: {
  // Next 16: searchParams is async (a Promise) and must be awaited.
  searchParams: Promise<{ status?: string }>;
}): Promise<JSX.Element> {
  const { status: rawStatus } = await searchParams;
  const status: Status = (['paid', 'cancelled', 'expired', 'unavailable'] as const).includes(
    rawStatus as Status,
  )
    ? (rawStatus as Status)
    : 'unavailable';
  const { emoji, title, body } = COPY[status];

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-6 py-16 text-center">
      <div className="card-lift w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="text-5xl" aria-hidden>
          {emoji}
        </div>
        <h1 className="mt-4 font-display text-2xl font-semibold text-ink">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">{body}</p>
        <p className="mt-6 text-xs text-muted">
          Questions? Email{' '}
          <a className="text-accent underline" href={`mailto:${BRAND.supportEmail}`}>
            {BRAND.supportEmail}
          </a>
          .
        </p>
      </div>
    </main>
  );
}
