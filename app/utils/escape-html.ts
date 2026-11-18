/**
 * The ONE canonical HTML-escape helper (Telegram parse_mode=HTML, emails).
 * Do not write local copies; an inventory test fails if one appears.
 *
 * `apostrophe: true` additionally escapes `'` as `&#39;` (used by emails).
 */
export function escapeHtml(text: string, options: { apostrophe?: boolean } = {}): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return options.apostrophe ? escaped.replace(/'/g, "&#39;") : escaped;
}
