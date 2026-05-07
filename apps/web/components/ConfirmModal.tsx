'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export type ConfirmSeverity = 'default' | 'warning' | 'danger';

export interface ConfirmModalProps {
  readonly open: boolean;
  readonly title: string;
  readonly body: ReactNode;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly severity?: ConfirmSeverity;
  /** If set, user must type this exact string before the Confirm button enables. */
  readonly typeToConfirm?: string;
  readonly onConfirm: () => Promise<void> | void;
  readonly onClose: () => void;
}

export function ConfirmModal({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  severity = 'default',
  typeToConfirm,
  onConfirm,
  onClose,
}: ConfirmModalProps): JSX.Element | null {
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  // Escape closes; reset state when reopened.
  useEffect(() => {
    if (!open) {
      setTyped('');
      setBusy(false);
      setLocalError(null);
      return;
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const confirmDisabled = busy || (typeToConfirm != null && typed !== typeToConfirm);
  const buttonClass =
    severity === 'danger'
      ? 'bg-red-600 hover:bg-red-700'
      : severity === 'warning'
        ? 'bg-amber-600 hover:bg-amber-700'
        : 'bg-accent hover:bg-blue-700';
  const accentBar =
    severity === 'danger'
      ? 'bg-red-600'
      : severity === 'warning'
        ? 'bg-amber-500'
        : 'bg-accent';

  async function handleConfirm(): Promise<void> {
    if (confirmDisabled) return;
    setBusy(true);
    setLocalError(null);
    try {
      await onConfirm();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-lg bg-paper shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`h-1 w-full ${accentBar}`} />
        <div className="space-y-3 p-5">
          <h2 id="confirm-title" className="text-lg font-semibold">
            {title}
          </h2>
          <div className="text-sm text-muted leading-relaxed">{body}</div>
          {typeToConfirm ? (
            <div>
              <label className="mb-1 block text-xs text-muted">
                Type{' '}
                <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-ink">
                  {typeToConfirm}
                </code>{' '}
                to confirm:
              </label>
              <input
                type="text"
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
              />
            </div>
          ) : null}
          {localError ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{localError}</p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t bg-slate-50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-paper disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={confirmDisabled}
            className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 ${buttonClass}`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
