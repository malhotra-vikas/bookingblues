import type { Metadata } from 'next';

import { BRAND } from '../../../lib/brand';

export const metadata: Metadata = {
  title: 'Contact — KeeprSteady',
  description: `Book a 15-minute demo or email ${BRAND.salesEmail}. We answer in one business day.`,
  alternates: { canonical: '/contact' },
};

export default function ContactPage(): JSX.Element {
  return (
    <div className="px-6 py-12 max-w-3xl mx-auto">
      <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-ink">Get in touch</h1>
      <p className="mt-3 text-muted">
        We typically reply within one business day. Faster: pick a slot below for a 15-minute demo.
      </p>

      <section className="mt-10 rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur shadow-card p-6">
        <h2 className="text-lg font-semibold text-ink dark:text-slate-100">Book a 15-min demo</h2>
        <p className="mt-1 text-sm text-muted">
          Live walkthrough of the AI booking flow, the dashboard, and the deposit setup. No card
          required.
        </p>
        <div className="mt-4 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800">
          {/*
            Cal.com inline embed via iframe. Loads on the client, height fixed
            to a sensible default — Cal handles internal scrolling. Falls back
            to a plain link if the iframe is blocked.
          */}
          <iframe
            src={`${BRAND.demoBookingUrl}?embed=true`}
            title="Book a demo with KeeprSteady"
            className="w-full"
            style={{ height: '720px', border: '0' }}
            loading="lazy"
            allow="camera; microphone; fullscreen; payment"
          />
        </div>
        <p className="mt-3 text-xs text-muted">
          Can&apos;t see the booking window?{' '}
          <a
            href={BRAND.demoBookingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Open it in a new tab.
          </a>
        </p>
      </section>

      <section className="mt-10 grid sm:grid-cols-2 gap-4">
        <div className="card-lift rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur shadow-card p-6">
          <p className="text-xs font-semibold tracking-[0.16em] uppercase text-accent mb-2">
            Sales &amp; support
          </p>
          <a
            href={`mailto:${BRAND.salesEmail}`}
            className="text-lg font-medium text-ink dark:text-slate-100 underline"
          >
            {BRAND.salesEmail}
          </a>
          <p className="mt-2 text-sm text-muted">
            New subscribers, billing questions, partnership inquiries. We answer in one business
            day.
          </p>
        </div>
        <div className="card-lift rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur shadow-card p-6">
          <p className="text-xs font-semibold tracking-[0.16em] uppercase text-accent mb-2">
            Already a subscriber?
          </p>
          <p className="text-sm text-ink dark:text-slate-100">
            Sign in to your dashboard for in-app support, or use the same email above. Settings →
            Billing handles plan changes and cancellation in 2 clicks.
          </p>
        </div>
      </section>
    </div>
  );
}
