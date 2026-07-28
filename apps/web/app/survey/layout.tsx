import type { ReactNode } from 'react';

import { LegalFooter } from '../../components/LegalFooter';
import { Logo } from '../../components/Logo';
import { BRAND } from '../../lib/brand';

/**
 * Standalone chrome for the survey subdomain. Deliberately NOT the marketing
 * layout: its nav links are root-relative, and on missedcalls.keeprsteady.com
 * they'd point at paths this host doesn't serve. Everything here is an absolute
 * link back to the apex domain.
 */
export default function SurveyLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-3">
        <a href={`https://${BRAND.domain}`} className="no-underline" aria-label={`${BRAND.name} home`}>
          <Logo />
        </a>
        <span className="hidden sm:inline text-xs text-muted dark:text-slate-400 leading-tight">
          by {BRAND.legalEntity}
        </span>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-slate-200 dark:border-slate-800 mt-12">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <LegalFooter variant="marketing" />
        </div>
      </footer>
    </div>
  );
}
