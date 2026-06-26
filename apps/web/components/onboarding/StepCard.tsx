import type { ReactNode } from 'react';

export function StepCard({
  number,
  title,
  description,
  done,
  children,
}: {
  number: number;
  title: string;
  description?: string;
  done: boolean;
  children?: ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur shadow-card p-5">
      <header className="flex items-center gap-3">
        <span
          className={`inline-flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold ${
            done ? 'bg-brand-sheen text-white shadow-sm' : 'bg-accent-soft text-accent'
          }`}
          aria-hidden
        >
          {done ? '✓' : number}
        </span>
        <h3 className="font-medium dark:text-slate-100">{title}</h3>
        {done ? <span className="text-xs text-emerald-700 dark:text-emerald-400 ml-auto">Done</span> : null}
      </header>
      {description ? <p className="mt-2 text-sm text-muted dark:text-slate-400">{description}</p> : null}
      {children ? <div className="mt-3">{children}</div> : null}
    </section>
  );
}
