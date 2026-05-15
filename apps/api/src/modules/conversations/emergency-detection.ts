/**
 * Plumbing-emergency keyword detection (PROGRESS.md Slice 17 — item 17).
 *
 * On every inbound caller SMS we scan the body for emergency markers. If any
 * are matched, the SMS webhook handler sends an out-of-band alert to the
 * plumber's personal phone with the caller's number, so the plumber can
 * decide to call back directly. The AI advance loop runs in parallel —
 * whichever surface gets to the caller first wins. No 60s timeout / fallback
 * in v1.
 *
 * Keyword list comes from the plumber roadmap in `docs/PROGRESS.md`. Kept
 * tight on purpose — false positives (alerting the plumber for a "slight
 * leak") are worse than false negatives (the AI still answers the call
 * normally; we lose the alert SMS).
 *
 * Match is case-insensitive substring with word-boundary awareness for
 * single-word terms. Multi-word terms (e.g. "burst pipe") match as plain
 * substrings since word boundaries inside multi-word phrases are noisy.
 */

const SINGLE_WORD_KEYWORDS = [
  'flooding',
  // Add variants here as we learn from real calls.
] as const;

const MULTI_WORD_KEYWORDS = [
  'burst pipe',
  'pipe burst',
  'no water',
  'sewage backup',
  'gas smell',
  'smell gas',
  'smell of gas',
  'carbon monoxide',
  'co alarm',
  'water everywhere',
] as const;

/** Returns the first matched keyword (lowercased) or null. */
export function detectEmergencyKeyword(body: string): string | null {
  const normalized = body.toLowerCase();
  for (const phrase of MULTI_WORD_KEYWORDS) {
    if (normalized.includes(phrase)) return phrase;
  }
  for (const word of SINGLE_WORD_KEYWORDS) {
    // \b doesn't work cleanly around punctuation in unicode contexts but is
    // fine for our ASCII keyword set. Match `flooding`, `flooding!`, etc.
    if (new RegExp(`\\b${word}\\b`).test(normalized)) return word;
  }
  return null;
}
