import QRCode from 'qrcode';

/**
 * "Call us" QR code for an operator. Scanning it offers to CALL the operator's
 * KeeprSteady (Twilio) number, which runs the existing missed-call flow
 * unchanged: greeting → press-1 SMS consent → opening text → AI booking.
 *
 * It points at the KeeprSteady number, not the operator's own phone: calling
 * the operator would ring them first, and if they answered the flow wouldn't
 * start. No server side and no tracking (a plain `tel:` link). ADR 0011.
 */
export function callUri(twilioNumberE164: string): string {
  return `tel:${twilioNumberE164}`;
}

/** "(863) 250-5262" for a US E.164 number; other numbers unchanged. */
export function formatPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

/** A filename-safe slug of the business name. */
export function fileSlug(businessName: string): string {
  return (
    businessName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'business'
  );
}

// ── Styled rendering ───────────────────────────────────────────────────────
//
// The `qrcode` library computes the code (error correction level H: up to ~30%
// of it can be damaged or covered and it still scans); we only draw it. What
// keeps it scannable: dark modules on a white background (the gradient stays
// in the dark purples), the three corner "eyes" kept at their exact size, a
// quiet zone of 4 modules, and a centre badge covering well under 10% of the
// modules.

const UNIT = 10; // px per module in the SVG coordinate space
const QUIET = 4; // modules of white margin (the spec's quiet zone)
// Data modules use only the DARK end of the brand range: a gradient up to the
// lighter brand purple (#6B3FA0) stopped decoding at 2000 px+ (jsQR test,
// 2026-11-09); deep → dark decodes at every size tested, 120 to 3200 px.
// The phone badge isn't data, so it can use the brighter violet.
const BRAND = {
  deep: '#2E1065',
  dark: '#55307F',
  violet: '#8B5CF6',
  line: '#E4D8F5',
};

// Material Design "call" icon (Apache-2.0), 24×24 viewBox.
const PHONE_PATH =
  'M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z';

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface StyledQrOptions {
  /** Text under the code, e.g. "SCAN TO CALL". Omit for the bare code. */
  readonly caption?: string;
}

/**
 * Branded SVG: rounded purple dots with a gradient, rounded corner eyes, a
 * phone badge in the middle and an optional caption. Pure and synchronous.
 */
export function styledQrSvg(twilioNumberE164: string, opts: StyledQrOptions = {}): string {
  const qr = QRCode.create(callUri(twilioNumberE164), { errorCorrectionLevel: 'H' });
  const n = qr.modules.size;
  const dark = (r: number, c: number): boolean => Boolean(qr.modules.get(r, c));

  // Centre badge: an odd-sized square of cleared modules (~6% of the code).
  let badge = Math.round(n * 0.24);
  if (badge % 2 === 0) badge += 1;
  const badgeStart = (n - badge) / 2;
  const inBadge = (r: number, c: number): boolean =>
    r >= badgeStart && r < badgeStart + badge && c >= badgeStart && c < badgeStart + badge;

  // The three 7×7 finder patterns are drawn as shapes, not dots.
  const finders: Array<[number, number]> = [
    [0, 0],
    [0, n - 7],
    [n - 7, 0],
  ];
  const inFinder = (r: number, c: number): boolean =>
    finders.some(([fr, fc]) => r >= fr && r < fr + 7 && c >= fc && c < fc + 7);

  const codeSize = (n + QUIET * 2) * UNIT;
  const captionHeight = opts.caption ? 5 * UNIT : 0;
  const height = codeSize + captionHeight;
  const at = (m: number): number => (m + QUIET) * UNIT;
  const id = `qr${twilioNumberE164.replace(/\D/g, '')}`;

  const dots: string[] = [];
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (!dark(r, c) || inFinder(r, c) || inBadge(r, c)) continue;
      // Rounded squares that touch their neighbours: soft look, but no gaps
      // between adjacent modules (round dots failed to decode at 1200 px).
      dots.push(
        `<rect x="${at(c)}" y="${at(r)}" width="${UNIT}" height="${UNIT}" rx="${UNIT * 0.32}"/>`,
      );
    }
  }

  const eyes = finders
    .map(([fr, fc]) => {
      const x = at(fc);
      const y = at(fr);
      return (
        `<rect x="${x + UNIT / 2}" y="${y + UNIT / 2}" width="${UNIT * 6}" height="${UNIT * 6}" rx="${UNIT * 1.2}" fill="none" stroke="${BRAND.dark}" stroke-width="${UNIT}"/>` +
        `<rect x="${x + UNIT * 2}" y="${y + UNIT * 2}" width="${UNIT * 3}" height="${UNIT * 3}" rx="${UNIT * 0.7}" fill="${BRAND.deep}"/>`
      );
    })
    .join('');

  // Phone badge: white tile (keeps the cleared area clean) with a purple disc.
  const bx = at(badgeStart);
  const bSize = badge * UNIT;
  const cx = bx + bSize / 2;
  const discR = bSize * 0.36;
  const iconScale = (discR * 1.15) / 24;
  const badgeSvg =
    `<rect x="${bx + UNIT * 0.4}" y="${bx + UNIT * 0.4}" width="${bSize - UNIT * 0.8}" height="${bSize - UNIT * 0.8}" rx="${UNIT * 1.6}" fill="#fff"/>` +
    `<circle cx="${cx}" cy="${cx}" r="${discR}" fill="url(#${id}-b)"/>` +
    `<path d="${PHONE_PATH}" fill="#fff" transform="translate(${cx - 12 * iconScale} ${cx - 12 * iconScale}) scale(${iconScale})"/>`;

  const caption = opts.caption
    ? `<text x="${codeSize / 2}" y="${codeSize + UNIT * 1.4}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif" font-size="${UNIT * 2.6}" font-weight="800" letter-spacing="${UNIT * 0.35}" fill="${BRAND.dark}">${escapeXml(opts.caption)}</text>`
    : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${codeSize} ${height}" width="${codeSize}" height="${height}" shape-rendering="geometricPrecision">` +
    `<defs><linearGradient id="${id}-g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${BRAND.deep}"/><stop offset="1" stop-color="${BRAND.dark}"/>` +
    `</linearGradient>` +
    `<linearGradient id="${id}-b" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${BRAND.dark}"/><stop offset="1" stop-color="${BRAND.violet}"/>` +
    `</linearGradient></defs>` +
    `<rect width="${codeSize}" height="${height}" rx="${UNIT * 3}" fill="#fff" stroke="${BRAND.line}" stroke-width="${UNIT * 0.3}"/>` +
    `<g fill="url(#${id}-g)">${dots.join('')}</g>` +
    eyes +
    badgeSvg +
    caption +
    `</svg>`
  );
}

/**
 * PNG data URL of the styled code, `width` px wide (browser only: rasterised
 * through an <img> and a <canvas>).
 */
export function styledQrPngDataUrl(
  twilioNumberE164: string,
  opts: StyledQrOptions = {},
  width = 1200,
): Promise<string> {
  const svg = styledQrSvg(twilioNumberE164, opts);
  const [, w, h] = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg) ?? [];
  const height = Math.round((width * Number(h)) / Number(w));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('canvas unavailable'));
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('could not render the QR code'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}
