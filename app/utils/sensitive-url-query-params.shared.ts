export const SENSITIVE_URL_QUERY_PARAMS = ["code", "state", "target"] as const;

const SENSITIVE_QUERY_SNIPPET = /\?[^#\s]*\bcode=/i;

export function stripSensitiveUrlQueryParams(href: string): string {
  try {
    const parsed = new URL(href, "http://localhost");
    for (const key of SENSITIVE_URL_QUERY_PARAMS) {
      parsed.searchParams.delete(key);
    }
    if (parsed.hash.includes("?")) {
      const [hashPath, hashQuery = ""] = parsed.hash.slice(1).split("?", 2);
      const hashParams = new URLSearchParams(hashQuery);
      for (const key of SENSITIVE_URL_QUERY_PARAMS) {
        hashParams.delete(key);
      }
      const nextHashQuery = hashParams.toString();
      parsed.hash = nextHashQuery
        ? `#${hashPath}?${nextHashQuery}`
        : hashPath
          ? `#${hashPath}`
          : "";
    } else if (parsed.hash) {
      const hashBody = parsed.hash.slice(1);
      const hashParams = new URLSearchParams(hashBody);
      const stripped = SENSITIVE_URL_QUERY_PARAMS.some((key) => hashParams.has(key));
      if (stripped) {
        for (const key of SENSITIVE_URL_QUERY_PARAMS) {
          hashParams.delete(key);
        }
        const next = hashParams.toString();
        parsed.hash = next ? `#${next}` : "";
      }
    }
    if (/^https?:\/\//i.test(href)) {
      return parsed.toString();
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    const queryStart = href.indexOf("?");
    const hashStart = href.indexOf("#");
    let end = href.length;
    if (queryStart >= 0) end = Math.min(end, queryStart);
    if (hashStart >= 0) end = Math.min(end, hashStart);
    return href.slice(0, end);
  }
}

export function shouldRedactSensitiveHeaderValue(value: string): boolean {
  if (SENSITIVE_QUERY_SNIPPET.test(value)) return true;
  return SENSITIVE_URL_QUERY_PARAMS.some((key) => new RegExp(`[?&#]${key}=`, "i").test(value));
}

export function redactSensitiveSentryRequestHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) return headers;
  const next: Record<string, string> = { ...headers };
  for (const [key, value] of Object.entries(next)) {
    if (key.toLowerCase() === "referer" || shouldRedactSensitiveHeaderValue(value)) {
      next[key] = stripSensitiveUrlQueryParams(value);
    }
  }
  return next;
}
