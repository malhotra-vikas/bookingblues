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
        {BRAND.name} is a service operated by {BRAND.legalEntity}. {BRAND.name} is an AI assistant
        for home-service businesses: when a contractor can&apos;t answer a call, it texts the caller
        back, answers their questions, books the appointment, and adds it to the contractor&apos;s
        Google Calendar. The AI may not always respond accurately — every conversation is monitored
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
          <span>© {new Date().getFullYear()} {BRAND.legalEntity}</span>
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
          <Link href="/careers" className="no-underline hover:text-ink dark:hover:text-slate-100">
            Careers
          </Link>
          <Link href="/privacy" className="no-underline hover:text-ink dark:hover:text-slate-100">
            Privacy Policy
          </Link>
          <Link href="/terms" className="no-underline hover:text-ink dark:hover:text-slate-100">
            Terms of Service
          </Link>
          <Link href="/messaging" className="no-underline hover:text-ink dark:hover:text-slate-100">
            SMS Program
          </Link>
          <span className="inline-flex items-center gap-3">
            <SocialLink href={BRAND.linkedinUrl} label="KeeprSteady on LinkedIn">
              <LinkedinIcon />
            </SocialLink>
            <SocialLink href={BRAND.instagramUrl} label="KeeprSteady on Instagram">
              <InstagramIcon />
            </SocialLink>
            <SocialLink href={BRAND.xUrl} label="KeeprSteady on X">
              <XIcon />
            </SocialLink>
          </span>
        </nav>
      </div>
    </div>
  );
}

function SocialLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="inline-flex items-center no-underline hover:text-ink dark:hover:text-slate-100"
    >
      {children}
    </a>
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

function InstagramIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function XIcon(): JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817-5.967 6.817H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644Z" />
    </svg>
  );
}
