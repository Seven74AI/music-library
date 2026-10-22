/**
 * Helpers for route loaders that proxy to an internal API route.
 *
 * `request.url` follows Host / X-Forwarded-Host, so the fetch origin must be
 * pinned to a trusted, configured origin (SITE_URL, or loopback as a fallback).
 * Only the session cookie is forwarded — never the full incoming headers,
 * which may carry Authorization, Host, X-Forwarded-Host, etc. Forwarding the
 * full set is an SSRF + credential-leak vector on admin/curator-gated pages.
 */

function trustedOrigin(): string {
  const configured = process.env.SITE_URL?.trim();
  return configured
    ? configured.replace(/\/$/, "")
    : `http://127.0.0.1:${process.env.PORT || "3000"}`;
}

/** Build an absolute URL on the trusted origin for the given pathname (and query). */
export function trustedInternalUrl(pathname: string, search?: string): string {
  const url = new URL(pathname, `${trustedOrigin()}/`);
  if (search) url.search = search;
  return url.toString();
}

/** Extract only the session cookie from the incoming request, dropping the rest. */
export function sessionCookie(request: Request): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  return (
    cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.toLowerCase().startsWith("en_session=")) ?? null
  );
}

/** Proxy a loader to an internal API route using a trusted origin + session cookie only. */
export function fetchInternal(
  request: Request,
  pathname: string,
  search?: string,
): Promise<Response> {
  const cookie = sessionCookie(request);
  return fetch(trustedInternalUrl(pathname, search), {
    headers: cookie ? { cookie } : {},
  });
}
