import Image from 'next/image';

import { BRAND } from '../lib/brand';

/**
 * Header brand lockup: the rounded K mark + wordmark text. The mark is a
 * dark chip (logo-mark.png) so it reads on both light and dark headers,
 * where the bare lavender wordmark would wash out on white. `priority`
 * since it's above the fold on every page.
 */
export function Logo({ className }: { className?: string }): JSX.Element {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <Image
        src="/logo-mark.png"
        alt=""
        width={28}
        height={28}
        priority
        className="rounded-md"
      />
      <span className="font-semibold tracking-tight text-ink dark:text-slate-100">
        {BRAND.name}
      </span>
    </span>
  );
}
