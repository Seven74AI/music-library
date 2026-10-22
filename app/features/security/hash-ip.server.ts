import { createHash } from "node:crypto";

/**
 * Used when `IP_HASH_SALT` is unset outside production.
 * Documented in `.env.example`. Production refuses to hash without a salt.
 */
export const DEV_IP_HASH_SALT = "dev-ip-hash-salt-change-me";

export function getIpHashSalt(): string {
  const salt = process.env.IP_HASH_SALT;
  if (salt) return salt;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "IP_HASH_SALT environment variable is required in production. Generate one with: openssl rand -hex 32",
    );
  }
  return DEV_IP_HASH_SALT;
}

/**
 * Stable SHA-256 prefix for an IP. The same address and salt always hash the
 * same way; the stored value is not the address and cannot be reversed to it.
 */
export function hashIP(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 16);
}

/**
 * Client address. This app runs behind Fly.io's proxy, which overwrites
 * `fly-client-ip` with the real peer address and also overwrites
 * `x-forwarded-for`, so both are trustworthy here. `cf-connecting-ip` is
 * Cloudflare-only and is deliberately NOT trusted: Fly.io does not sanitize
 * it, so a client could spoof it to defeat IP-based detection. Returns null
 * when no trusted header is present.
 */
export function getClientIp(request: Request): string | null {
  const fly = request.headers.get("fly-client-ip")?.trim();
  if (fly) return fly;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return null;
}

export function hashRequestIp(request: Request, salt = getIpHashSalt()): string | null {
  const ip = getClientIp(request);
  if (!ip) return null;
  return hashIP(ip, salt);
}
