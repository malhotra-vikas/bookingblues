/**
 * Short-link helpers. UUIDs contain hyphens (`9a126dc2-e625-…`) and some SMS
 * clients stop linkifying a URL at the first hyphen, breaking the tap target.
 * We therefore put the HYPHEN-FREE 32-hex form in `/pay/:token` and `/cal/:token`
 * links and expand it back to a canonical UUID server-side before lookup.
 */

/** UUID → 32 hex chars, no hyphens (for embedding in an SMS link). */
export function compactUuid(uuid: string): string {
  return uuid.replace(/-/g, '');
}

/**
 * Token → canonical UUID. Accepts both the hyphen-free 32-hex form and an
 * already-hyphenated UUID (so old links keep working). Returns the input
 * unchanged if it isn't 32 hex chars — let the DB/validator reject it.
 */
export function expandUuid(token: string): string {
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(token)) {
    return token;
  }
  const hex = token.replace(/[^0-9a-fA-F]/g, '');
  if (hex.length !== 32) return token;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
