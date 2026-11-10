# ADR 0011 — "Call us" QR code via a `tel:` link and the `qrcode` library

**Status**: accepted (2026-11-09).

## Context

Operators want a QR code for trucks, flyers, invoices and their website that
gets a customer into the booking flow. The missed-call flow (call → greeting →
press-1 SMS consent → opening text → AI booking) is stable. Text-first
conversations (a customer texting the number without calling) are planned but
postponed: they change consent and first-message compliance, and a fresh pass
on main was reverted on 2026-11-09 to keep the stable flow.

## Decision

- The QR code encodes `tel:<operator's KeeprSteady/Twilio number>`. Scanning
  it offers to CALL that number, which runs the existing missed-call flow
  unchanged, including the IVR consent. No server code, no new consent path.
- It points at the KeeprSteady number, not the operator's own phone: calling
  the operator would ring them first, and if they answered, the flow wouldn't
  start.
- Generated in the browser with `qrcode` (1.5.4, MIT, widely used) and
  `@types/qrcode` (1.5.5), web app only. Error correction level H so a scuffed
  or small print still scans.
- Branded rendering (`lib/call-qr.ts` `styledQrSvg`): the library computes the
  matrix; we draw rounded modules in a deep-purple gradient, rounded corner
  eyes, a phone badge in the centre (~6% of modules cleared; level H tolerates
  ~30%) and an optional "SCAN TO CALL" caption. Verified with a real decoder
  (jsQR) at 120–3200 px. A gradient reaching the lighter brand purple
  (#6B3FA0) failed at 2000 px+, so data modules stay between #2E1065 and
  #55307F; only the non-data badge uses the brighter violet.
- Settings → "Call-us QR code": preview, PNG (1200 px) and SVG downloads, and a
  printable poster page (`/settings/qr-poster`) that the browser prints or
  saves as PDF (no PDF library).

## Consequences

- No scan counts or attribution. A redirect URL (`/t/<code>`) would add those
  and survive a number change; revisit with the text-first work (PROGRESS.md
  item 7).
- If an operator's KeeprSteady number changes (released / re-provisioned),
  printed codes stop working; they must reprint.
- When text-first ships, an `sms:` QR option can sit beside this one.
