import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { BRAND } from '../lib/brand';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(`https://${BRAND.domain}`),
  title: {
    default: `${BRAND.name} — AI Dispatcher for Home Service Pros | Never Miss a Job`,
    template: `%s — ${BRAND.name}`,
  },
  description:
    'AI books your missed calls by text in under 10 seconds. Built for plumbers, HVAC, roofers, and electricians. 7-day free trial.',
  applicationName: BRAND.name,
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon.png', type: 'image/png', sizes: '32x32' },
      { url: '/icon-192.png', type: 'image/png', sizes: '192x192' },
      { url: '/icon-512.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    type: 'website',
    siteName: BRAND.name,
    url: `https://${BRAND.domain}`,
    title: `${BRAND.name} — AI Dispatcher for Home Service Pros`,
    description:
      'AI books your missed calls by text in under 10 seconds. Built for plumbers, HVAC, roofers, and electricians.',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: BRAND.name }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${BRAND.name} — AI Dispatcher for Home Service Pros`,
    description:
      'AI books your missed calls by text in under 10 seconds. Built for plumbers, HVAC, roofers, and electricians.',
    images: ['/og-image.png'],
  },
};

/**
 * Runs before React hydration so the `html.dark` class is set on the
 * very first paint — avoids a light-mode flash for users who chose dark.
 * Reads `localStorage` (explicit choice via `ThemeToggle`), then falls
 * back to the OS preference.
 */
const NO_FLASH_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('bb-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var dark = stored ? stored === 'dark' : prefersDark;
    if (dark) document.documentElement.classList.add('dark');
  } catch (_) {}
})();
`.trim();

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    // The NO_FLASH_SCRIPT below sets `html.dark` before React hydrates, so the
    // server (no class) and client (class="dark") intentionally differ on this
    // element. suppressHydrationWarning silences that — scoped to <html> only,
    // one level deep, so real mismatches inside the tree still surface.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-paper text-ink dark:bg-slate-950 dark:text-slate-100">
        {children}
      </body>
    </html>
  );
}
