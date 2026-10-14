/**
 * Production cap for every non-GET request whose path includes `/admin`,
 * including a logged-in admin. A session cookie is not used to skip it.
 * Development and Playwright multiply this so tests are not blocked.
 * Login, signup, and password reset stay on the stricter sensitive tier.
 */
export const ADMIN_MUTATION_LIMIT_PER_MINUTE = 60;

const SENSITIVE_PATHS = [
  "/login",
  "/signup",
  "/verify",
  "/onboarding",
  "/reset-password",
  "/settings/profile",
  "/resources/login",
  "/resources/verify",
] as const;

export type MutationRateLimitTier = "admin" | "sensitive" | "general" | "read";

/** Which per-minute limiter a request should use. */
export function mutationRateLimitTier(method: string, path: string): MutationRateLimitTier {
  const isRead = method === "GET" || method === "HEAD";
  if (!isRead && path.includes("/admin")) return "admin";
  if (!isRead && SENSITIVE_PATHS.some((candidate) => path.includes(candidate))) {
    return "sensitive";
  }
  // /verify is a GET that can carry a token in the query string.
  if (path.includes("/verify")) return "sensitive";
  if (isRead) return "read";
  return "general";
}
