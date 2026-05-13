import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'BookingBlues',
  description: 'Never miss a job. We turn missed calls into booked appointments.',
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
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-paper text-ink dark:bg-slate-950 dark:text-slate-100">
        {children}
      </body>
    </html>
  );
}
