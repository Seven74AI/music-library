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
 * Client address from the platform headers this app already trusts for rate
 * limiting (`Cf-Connecting-Ip`, then `fly-client-ip`, then the first
 * `X-Forwarded-For` hop). Returns null when none are present.
 */
export function getClientIp(request: Request): string | null {
  const cf = request.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
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
