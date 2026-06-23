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

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <body className="min-h-screen bg-paper text-ink">{children}</body>
    </html>
  );
}
