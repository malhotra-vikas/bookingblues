/**
 * Shared branded email shell (KeeprSteady). Mirrors the Supabase auth templates
 * in docs/SUPABASE_EMAIL_TEMPLATES.md so every transactional email we send from
 * the app looks the same: white card on a light background, uppercase brand
 * eyebrow, primary button, and a footer tagline. Table-based markup for email
 * client compatibility; all styles inline.
 */

const BRAND_NAME = 'KeeprSteady';
const BRAND_BLUE = '#0b5cd6';
const FOOTER_TAGLINE = 'We text back missed calls so you stop losing jobs to voicemail.';

export interface BrandedEmailArgs {
  /** Bold headline at the top of the card. */
  heading: string;
  /** Inner HTML for the body (already-escaped/trusted markup — pass paragraphs). */
  bodyHtml: string;
  /** Optional primary button. */
  cta?: { label: string; href: string };
  /** Optional smaller muted note under the body/CTA (e.g. a disclaimer). */
  footnoteHtml?: string;
}

export function brandedEmailHtml(args: BrandedEmailArgs): string {
  const button = args.cta
    ? `<tr><td align="center" style="padding-bottom:26px;">
         <a href="${args.cta.href}" style="background:${BRAND_BLUE};color:#ffffff;text-decoration:none;display:inline-block;padding:14px 28px;border-radius:8px;font-weight:500;font-size:15px;">${escapeHtml(args.cta.label)}</a>
       </td></tr>`
    : '';
  const footnote = args.footnoteHtml
    ? `<tr><td style="font-size:12px;color:#94a3b8;line-height:1.5;padding-top:6px;">${args.footnoteHtml}</td></tr>`
    : '';

  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f8fafc;padding:32px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <tr><td align="center">
    <table width="540" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;padding:36px 32px;">
      <tr><td style="font-size:13px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND_BLUE};padding-bottom:14px;">${BRAND_NAME}</td></tr>
      <tr><td style="font-size:22px;font-weight:600;color:#0f172a;line-height:1.3;padding-bottom:14px;">${args.heading}</td></tr>
      <tr><td style="font-size:15px;color:#475569;line-height:1.6;padding-bottom:24px;">${args.bodyHtml}</td></tr>
      ${button}
      ${footnote}
    </table>
    <table width="540" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:16px;">
      <tr><td align="center" style="font-size:11px;color:#94a3b8;">${BRAND_NAME} · ${FOOTER_TAGLINE}</td></tr>
    </table>
  </td></tr>
</table>`;
}

export function escapeHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
