'use client';

import { useMemo, useState } from 'react';

import { fileSlug, formatPhone, styledQrPngDataUrl, styledQrSvg } from '../lib/call-qr';

const CAPTION = 'SCAN TO CALL';

interface Props {
  readonly businessName: string;
  /** The operator's KeeprSteady number; null until provisioned. */
  readonly twilioNumberE164: string | null;
}

const buttonClass =
  'rounded-md border border-slate-300 dark:border-slate-700 dark:text-slate-100 px-3 py-1.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50';

function download(href: string, filename: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Settings card: a QR code that, when scanned, calls the operator's KeeprSteady
 * number, so the caller gets the usual "we'll text you" flow. Preview,
 * PNG/SVG download and a printable poster.
 */
export function CallQrCard({ businessName, twilioNumberE164 }: Props): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  // Branded code with the "SCAN TO CALL" caption; the same SVG is the download.
  const svg = useMemo(
    () => (twilioNumberE164 ? styledQrSvg(twilioNumberE164, { caption: CAPTION }) : null),
    [twilioNumberE164],
  );

  if (!twilioNumberE164) {
    return (
      <p className="text-sm text-muted dark:text-slate-400">
        Your QR code appears here once your KeeprSteady number is set up (onboarding step 3).
      </p>
    );
  }

  const slug = fileSlug(businessName);

  async function downloadPng(): Promise<void> {
    try {
      download(await styledQrPngDataUrl(twilioNumberE164!, { caption: CAPTION }), `${slug}-call-qr.png`);
    } catch {
      setError('Could not create the PNG. Try again.');
    }
  }

  function downloadSvg(): void {
    if (!svg) return;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    download(url, `${slug}-call-qr.svg`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <div
        className="w-44 shrink-0 [&>svg]:h-auto [&>svg]:w-full"
        aria-label={`QR code that calls ${formatPhone(twilioNumberE164)}`}
        role="img"
        // Generated locally by the qrcode library from the operator's own number.
        dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
      />
      <div className="space-y-2 text-sm dark:text-slate-200">
        <p>
          When a customer scans this, their phone offers to call{' '}
          <strong>{formatPhone(twilioNumberE164)}</strong>, your KeeprSteady number. They get the same
          experience as a missed call: a short greeting, then a text to book.
        </p>
        <p className="text-xs text-muted dark:text-slate-400">
          Put it on your truck, flyers, invoices, door hangers or website.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" onClick={() => void downloadPng()} className={buttonClass}>
            Download PNG
          </button>
          <button type="button" onClick={downloadSvg} disabled={!svg} className={buttonClass}>
            Download SVG (for print shops)
          </button>
          <a
            href="/settings/qr-poster"
            target="_blank"
            rel="noopener"
            className="rounded-md border border-accent/40 bg-accent-soft px-3 py-1.5 text-xs text-accent hover:bg-accent/10"
          >
            Print poster
          </a>
        </div>
        {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
      </div>
    </div>
  );
}
