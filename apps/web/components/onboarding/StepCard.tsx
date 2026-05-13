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
    <section className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <header className="flex items-center gap-3">
        <span
          className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
            done ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-ink dark:bg-slate-700 dark:text-slate-200'
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
