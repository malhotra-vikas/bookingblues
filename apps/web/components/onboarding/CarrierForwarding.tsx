'use client';

import { useState } from 'react';

type Carrier = 'att' | 'verizon' | 'tmobile' | 'other';

interface CarrierEntry {
  readonly slug: Carrier;
  readonly name: string;
  /** GSM code with `{NUMBER}` placeholder for the operator's Twilio number (full E.164). */
  readonly noAnswer: string;
  readonly busy?: string;
  readonly disable: ReadonlyArray<string>;
  readonly note?: string;
}

const CARRIERS: ReadonlyArray<CarrierEntry> = [
  {
    slug: 'att',
    name: 'AT&T',
    noAnswer: '*61*{NUMBER}#',
    busy: '*67*{NUMBER}#',
    disable: ['##61#', '##67#'],
  },
  {
    slug: 'verizon',
    name: 'Verizon',
    noAnswer: '*71{NUMBER}',
    disable: ['*73'],
    note: "Verizon's *71 covers both no-answer AND busy in one code.",
  },
  {
    slug: 'tmobile',
    name: 'T-Mobile',
    noAnswer: '**61*{NUMBER}#',
    busy: '**67*{NUMBER}#',
    disable: ['##61#', '##67#'],
  },
  {
    slug: 'other',
    name: 'Other / I don\'t know',
    noAnswer: '',
    disable: [],
    note: "Most US carriers accept the AT&T-style *61* / *67* codes. Try those first; if they don't work, search '<carrier name> conditional call forwarding' for the right syntax. We'll auto-detect carriers in a future update.",
  },
];

export function CarrierForwarding({ twilioNumber }: { twilioNumber: string }): JSX.Element {
  const [carrier, setCarrier] = useState<Carrier>('att');
  const entry = CARRIERS.find((c) => c.slug === carrier)!;

  function fill(template: string): string {
    return template.replace('{NUMBER}', twilioNumber);
  }

  async function copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">
        On your business mobile, dial these codes to forward missed calls to your KeeprSteady
        number{' '}
        <span className="font-mono">{twilioNumber}</span>. Your phone still rings — only no-answer
        and busy calls forward to the AI.
      </p>
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted">Carrier</label>
        <select
          value={carrier}
          onChange={(e) => setCarrier(e.target.value as Carrier)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        >
          {CARRIERS.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {entry.slug !== 'other' ? (
        <div className="space-y-2 rounded-md border bg-slate-50 p-3 font-mono text-xs">
          <CodeRow label="No answer" code={fill(entry.noAnswer)} onCopy={copy} />
          {entry.busy ? <CodeRow label="Busy" code={fill(entry.busy)} onCopy={copy} /> : null}
          {entry.disable.length > 0 ? (
            <div className="border-t pt-2 text-muted">
              <span className="block mb-1">Disable forwarding later:</span>
              {entry.disable.map((c) => (
                <CodeRow key={c} label="" code={c} onCopy={copy} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {entry.note ? <p className="text-xs text-muted">{entry.note}</p> : null}

      <details className="text-xs">
        <summary className="cursor-pointer text-accent">How to test it</summary>
        <ol className="mt-2 list-decimal pl-5 space-y-1 text-muted">
          <li>Dial the no-answer code above on your business phone. Carrier confirms with a tone or SMS.</li>
          <li>Have a friend (or another phone of yours) call your business number.</li>
          <li>Don&apos;t pick up. After ~5 rings the call should reach the AI greeting.</li>
          <li>Caller hangs up — within seconds they should receive an SMS from{' '}
            <span className="font-mono">{twilioNumber}</span>.</li>
          <li>Reply to confirm the SMS conversation works end-to-end.</li>
        </ol>
      </details>
    </div>
  );
}

function CodeRow({
  label,
  code,
  onCopy,
}: {
  label: string;
  code: string;
  onCopy: (text: string) => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      {label ? <span className="w-20 text-muted not-italic">{label}</span> : null}
      <span className="font-mono">{code}</span>
      <button
        type="button"
        onClick={() => onCopy(code)}
        className="ml-auto text-xs text-accent hover:underline"
      >
        Copy
      </button>
    </div>
  );
}
