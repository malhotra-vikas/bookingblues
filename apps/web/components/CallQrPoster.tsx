'use client';

import { useMemo } from 'react';

import { formatPhone, styledQrSvg } from '../lib/call-qr';

interface Props {
  readonly businessName: string;
  readonly twilioNumberE164: string;
}

/**
 * Printable "scan to call us" poster (US Letter). The toolbar is screen-only;
 * the browser's print dialog also offers "Save as PDF", so no PDF library.
 */
export function CallQrPoster({ businessName, twilioNumberE164 }: Props): JSX.Element {
  // Branded code without a caption: the poster's own headline says "Scan to call us".
  const svg = useMemo(() => styledQrSvg(twilioNumberE164), [twilioNumberE164]);
  const phone = formatPhone(twilioNumberE164);

  return (
    <div className="space-y-6">
      <style>{'@page { size: letter; margin: 0.6in; }'}</style>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 print:hidden">
        <span>
          Print this poster, or choose <strong>Save as PDF</strong> in the print dialog.
        </span>
        <button
          type="button"
          onClick={() => window.print()}
          disabled={!svg}
          className="rounded-md bg-accent px-4 py-2 text-white disabled:opacity-50"
        >
          Print
        </button>
      </div>

      <article className="mx-auto flex max-w-[7in] flex-col items-center gap-6 rounded-2xl border border-slate-200 bg-white px-10 py-12 text-center text-slate-900 print:border-0 print:p-0">
        <p className="text-2xl font-semibold uppercase tracking-wide">{businessName}</p>
        <h1 className="text-5xl font-bold leading-tight">Scan to call us</h1>
        <p className="text-xl text-slate-700">We&apos;ll text you right back to set up a time.</p>
        <div
          className="w-[3.8in] [&>svg]:h-auto [&>svg]:w-full"
          role="img"
          aria-label={`QR code that calls ${phone}`}
          // Generated locally (lib/call-qr.ts) from the operator's own number.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <p className="text-2xl">
          Or call <strong>{phone}</strong>
        </p>
        <p className="max-w-[5in] text-xs text-slate-500">
          Point your phone&apos;s camera at the code to call. Message and data rates may apply. Reply STOP to
          opt out of texts.
        </p>
      </article>
    </div>
  );
}
