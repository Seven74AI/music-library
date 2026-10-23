/**
 * Production cap for every non-GET request whose path includes an `/admin`
 * segment, including a logged-in admin. A session cookie is not used to skip it.
 * Development and Playwright multiply this so tests are not blocked.
 * Login, signup, and password reset stay on the stricter sensitive tier.
 */
export const ADMIN_MUTATION_LIMIT_PER_MINUTE = 60;

// Mutations on these paths are rate-limited more strictly. Paths are matched on
// whole segments (not substring), so `/login` matches but `/mylogin` does not.
const SENSITIVE_MUTATION_PATHS = [
  "/login",
  "/signup",
  "/onboarding",
  "/reset-password",
  "/settings/profile",
  "/resources/login",
] as const;

// `/verify` is sensitive for GET too — the token rides in the query string.
const SENSITIVE_ANY_METHOD_PATHS = ["/verify", "/resources/verify"] as const;

export type MutationRateLimitTier = "admin" | "sensitive" | "general" | "read";

function matchesPath(path: string, candidate: string): boolean {
  return path === candidate || path.startsWith(`${candidate}/`);
}

function hasAdminSegment(path: string): boolean {
  return path.split("/").includes("admin");
}

/** Which per-minute limiter a request should use. */
export function mutationRateLimitTier(method: string, path: string): MutationRateLimitTier {
  const isRead = method === "GET" || method === "HEAD";
  if (!isRead && hasAdminSegment(path)) return "admin";
  if (!isRead && SENSITIVE_MUTATION_PATHS.some((candidate) => matchesPath(path, candidate))) {
    return "sensitive";
  }
  // /verify is a GET that can carry a token in the query string.
  if (SENSITIVE_ANY_METHOD_PATHS.some((candidate) => matchesPath(path, candidate))) {
    return "sensitive";
  }
  if (isRead) return "read";
  return "general";
}
