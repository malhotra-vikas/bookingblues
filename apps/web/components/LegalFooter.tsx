import Link from 'next/link';

import { BRAND } from '../lib/brand';

/**
 * Site-wide legal footer (ED-13, ED-15, ED-19). Renders on every public route
 * — marketing and auth — so the AI disclaimer, TCPA opt-out notice, and links
 * to Privacy / Terms / Contact are always reachable. Stripe and Twilio also
 * require a published privacy policy + terms to keep using their APIs.
 */
export function LegalFooter({ variant }: { variant: 'marketing' | 'auth' }): JSX.Element {
  const condensed = variant === 'auth';
  return (
    <div className={condensed ? 'text-[11px]' : 'text-xs'}>
      <p
        className={`text-muted dark:text-slate-400 leading-relaxed ${
          condensed ? 'max-w-3xl' : 'max-w-4xl'
        }`}
      >
        {BRAND.name} automates SMS responses to missed calls on behalf of home service
        contractors. The AI may not always respond accurately — every conversation is monitored
        by our team, but human review is not guaranteed before delivery. Contractors are solely
        responsible for the appointments booked and deposits collected through this platform.
        {' '}
        {BRAND.name} is not liable for missed jobs, inaccurate quotes, or scheduling errors. Use
        of this service constitutes acceptance of our{' '}
        <Link href="/terms" className="underline">
          Terms of Service
        </Link>
        . SMS interactions comply with TCPA opt-out requirements — reply STOP to end messages.
      </p>
      <div
        className={`mt-4 flex flex-wrap items-center justify-between gap-3 ${
          condensed ? '' : 'pt-4 border-t border-slate-200 dark:border-slate-800'
        }`}
      >
        <div className="flex items-center gap-2 text-muted dark:text-slate-400">
          <span className="font-semibold text-ink dark:text-slate-100">{BRAND.name}</span>
          <span>·</span>
          <span>© {new Date().getFullYear()}</span>
        </div>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 text-muted dark:text-slate-400">
          <Link href="/pricing" className="no-underline hover:text-ink dark:hover:text-slate-100">
            Pricing
          </Link>
          <Link href="/faq" className="no-underline hover:text-ink dark:hover:text-slate-100">
            FAQ
          </Link>
          <Link href="/contact" className="no-underline hover:text-ink dark:hover:text-slate-100">
            Contact
          </Link>
          <Link href="/privacy" className="no-underline hover:text-ink dark:hover:text-slate-100">
            Privacy Policy
          </Link>
          <Link href="/terms" className="no-underline hover:text-ink dark:hover:text-slate-100">
            Terms of Service
          </Link>
          <a
            href={BRAND.linkedinUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="KeeprSteady on LinkedIn"
            className="inline-flex items-center no-underline hover:text-ink dark:hover:text-slate-100"
          >
            <LinkedinIcon />
          </a>
        </nav>
      </div>
    </div>
  );
}

function LinkedinIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.37V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.35-1.85 3.58 0 4.24 2.36 4.24 5.42v6.32ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.72v20.55C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0Z" />
    </svg>
  );
}
