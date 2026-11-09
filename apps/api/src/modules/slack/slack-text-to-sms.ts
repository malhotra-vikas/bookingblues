/**
 * Turn an agent's Slack message into plain SMS text. Slack sends its own markup
 * ("mrkdwn") and HTML entities; texted as-is the caller sees `*Sun, Nov 15*`
 * with the asterisks (prod 2026-11-09) or `<https://…|link>`.
 *
 * Formatting markers are only removed when they wrap text at word boundaries,
 * so an underscore in a URL or email (`first_last@x.com`) or a lone asterisk
 * ("5 * 3") is left alone.
 */
export function slackTextToSms(text: string): string {
  let s = text;

  // Links and references: <url|label>, <url>, <mailto:a|a>, <tel:+1…|label>,
  // user/channel mentions and broadcasts.
  s = s.replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, (_m, url: string, label: string) =>
    label === url ? url : `${label} (${url})`,
  );
  s = s.replace(/<(?:mailto|tel):[^|>]+\|([^>]+)>/g, '$1');
  s = s.replace(/<(?:mailto|tel):([^>]+)>/g, '$1');
  s = s.replace(/<(https?:\/\/[^>]+)>/g, '$1');
  s = s.replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1');
  s = s.replace(/<@[A-Z0-9]+(?:\|[^>]+)?>\s?/g, '');
  s = s.replace(/<!(?:here|channel|everyone)(?:\|[^>]+)?>\s?/g, '');

  // Code blocks and inline code: keep the content.
  s = s.replace(/```([\s\S]*?)```/g, '$1');
  s = s.replace(/`([^`\n]+)`/g, '$1');

  // *bold*, _italic_, ~strike~ — only when wrapping text at word boundaries.
  for (const mark of ['\\*', '_', '~']) {
    const re = new RegExp(`(^|[\\s(\\["'])${mark}(\\S(?:[^\\n]*?\\S)?)${mark}(?=$|[\\s)\\]"'.,!?:;])`, 'gm');
    s = s.replace(re, '$1$2');
  }

  // Slack escapes these three characters in message text.
  s = s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

  return s.trim();
}
