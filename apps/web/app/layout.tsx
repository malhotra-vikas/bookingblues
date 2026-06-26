import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter, Space_Grotesk } from 'next/font/google';

import { BRAND } from '../lib/brand';
import './globals.css';

// Body: Inter (clean, highly legible). Headings: Space Grotesk (geometric,
// characterful — gives the brand a human, designed feel vs. the system default).
const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: ['500', '600', '700'],
});

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

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body className="min-h-screen bg-paper text-ink font-sans">
        {/* Soft brand gradient wash + ambient blobs behind every page (fixed to
            the viewport so it stays consistent on scroll). This gives every page
            the same accented depth as the homepage hero. Content sections with
            their own backgrounds layer cleanly on top. */}
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-gradient-to-br from-accent-soft via-white to-accent-soft/50"
        >
          <div className="blob h-[30rem] w-[30rem] bg-accent-glow/20 -top-32 -left-24 animate-blob" />
          <div className="blob h-[34rem] w-[34rem] bg-accent-violet/15 top-1/4 -right-40 animate-blob [animation-delay:6s]" />
          <div className="blob h-[26rem] w-[26rem] bg-accent/10 bottom-0 left-1/3 animate-blob [animation-delay:11s]" />
        </div>
        {children}
      </body>
    </html>
  );
}
