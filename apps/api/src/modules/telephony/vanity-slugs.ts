/**
 * Vanity slug generation for Twilio number search (CLAUDE.md §9.1 — number
 * provisioning). Twilio's `Contains` filter accepts letters that it maps to
 * keypad digits server-side, so `ZEUS` → `9387` in the resulting number.
 *
 * Strategy: derive 2-4 candidate slugs from (business_name, category),
 * ordered by memorability. The cascading search tries each in order and
 * stops once it has enough hits. If none yield results in the requested area
 * code, the caller falls back to a plain area-code-only search.
 *
 * Pure function — no Twilio calls here. Unit-testable.
 */

/** Words to skip when picking the "distinctive" first token. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'of', 'for', 'to', 'by', 'at', 'in', 'on',
]);

/** Business-suffix tokens we always drop. */
const SUFFIXES = new Set([
  'llc', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company',
  'ltd', 'limited', 'lp', 'llp', 'pllc', 'pc',
]);

/** Trade-fallback patterns by operator category slug. */
const CATEGORY_FALLBACKS: Record<string, ReadonlyArray<string>> = {
  plumbing: ['PLUMB', 'PIPE', 'FIX', 'FAST'],
  hvac: ['HVAC', 'COOL', 'HEAT', 'FAST'],
  electrical: ['ELEC', 'AMP', 'FIX', 'FAST'],
  roofing: ['ROOF', 'TOP', 'FIX', 'FAST'],
  garage_door: ['DOOR', 'GATE', 'FIX', 'FAST'],
};

const MIN_LEN = 3;
const MAX_LEN = 7;

/**
 * Returns an ordered list of vanity slug candidates for Twilio's `Contains`
 * search. Empty list means we should skip vanity and just do a plain
 * area-code search.
 */
export function vanitySlugs(args: {
  businessName: string | null | undefined;
  category: string | null | undefined;
  max?: number;
}): ReadonlyArray<string> {
  const max = args.max ?? 4;
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string): void => {
    const norm = s.toUpperCase();
    if (norm.length < MIN_LEN || norm.length > MAX_LEN) return;
    if (seen.has(norm)) return;
    seen.add(norm);
    out.push(norm);
  };

  // 1. Distinctive tokens from business name (after stripping suffixes/stopwords).
  if (args.businessName) {
    const tokens = args.businessName
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 0 && !STOPWORDS.has(t) && !SUFFIXES.has(t));
    for (const token of tokens) {
      // Try the full token (clamped to MAX_LEN) and a 4-letter prefix.
      push(token.slice(0, MAX_LEN));
      if (token.length >= 5) push(token.slice(0, 4));
      if (out.length >= max) return out.slice(0, max);
    }
  }

  // 2. Category fallback (always added, in case business-name slugs are
  //    sparse in the requested area code).
  const cat = args.category ? CATEGORY_FALLBACKS[args.category] : undefined;
  if (cat) {
    for (const slug of cat) {
      push(slug);
      if (out.length >= max) break;
    }
  }

  return out.slice(0, max);
}
