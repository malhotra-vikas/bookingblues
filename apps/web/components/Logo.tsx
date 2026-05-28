import Image from 'next/image';

/**
 * Header brand mark — the rounded K logo on its own (no wordmark text beside
 * it). The dark chip reads on both light and dark headers. The wrapping
 * <Link> in each layout carries the accessible name, so alt stays meaningful
 * but isn't double-announced. `priority` since it's above the fold on every
 * page.
 */
export function Logo({ className }: { className?: string }): JSX.Element {
  return (
    <Image
      src="/logo-mark.png"
      alt="KeeprSteady"
      width={40}
      height={40}
      priority
      className={`rounded-md ${className ?? ''}`}
    />
  );
}
