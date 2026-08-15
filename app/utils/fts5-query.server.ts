/**
 * Build safe FTS5 MATCH expressions from user input.
 *
 * Users search for music titles, not FTS5 syntax. Every token is double-quoted
 * so operators (-, *, ^, :, NEAR, AND/OR/NOT, etc.) are literals. The app owns
 * prefix matching by appending * outside the closing quote.
 *
 * @see https://www.sqlite.org/fts5.html#fts5_query_syntax
 */

/**
 * True when a token contains at least one letter or number (unicode-aware).
 * Punctuation-only tokens are dropped so they never become MATCH noise.
 */
function hasSearchableContent(token: string): boolean {
  return /\p{L}|\p{N}/u.test(token);
}

/**
 * Convert raw user search text into a literal FTS5 query string.
 *
 * @returns Safe MATCH expression, or "" when nothing searchable remains
 */
export function toLiteralFts5Query(raw: string, options: { prefix?: boolean } = {}): string {
  const usePrefix = options.prefix ?? true;
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  const parts: string[] = [];
  for (const token of normalized.split(" ")) {
    if (!token || !hasSearchableContent(token)) continue;

    // FTS5 string rule: embed " as ""
    const quoted = `"${token.replace(/"/g, '""')}"`;
    // Prefix * must be outside quotes (inside quotes the tokenizer treats it as text)
    parts.push(usePrefix ? `${quoted}*` : quoted);
  }

  return parts.join(" ");
}

/**
 * Escape `%`, `_`, and `\` so they are literals in a SQL LIKE pattern.
 * Pair with `ESCAPE '\\'` in the SQL.
 */
export function escapeLikeLiterals(value: string): string {
  return value.replace(/([%_\\])/g, "\\$1");
}
