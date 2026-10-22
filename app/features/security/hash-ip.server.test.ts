import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { DEV_IP_HASH_SALT, getIpHashSalt, hashIP, hashRequestIp } from "./hash-ip.server.ts";

describe("hashIP", () => {
  test("same IP and salt always yield the same hash", () => {
    const salt = "test-salt";
    const ip = "203.0.113.10";
    expect(hashIP(ip, salt)).toBe(hashIP(ip, salt));
  });

  test("stores a 16-char digest that is not the plaintext address", () => {
    const ip = "203.0.113.10";
    const hash = hashIP(ip, "test-salt");
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(hash).not.toBe(ip);
    expect(hash).not.toContain("203.0.113.10");
    expect(hash).not.toBe(Buffer.from(ip).toString("hex").slice(0, 16));
    expect(hash).not.toBe(createHash("sha256").update(ip).digest("hex").slice(0, 16));
  });

  test("a different IP or salt changes the hash", () => {
    const hash = hashIP("203.0.113.10", "salt-a");
    expect(hashIP("203.0.113.11", "salt-a")).not.toBe(hash);
    expect(hashIP("203.0.113.10", "salt-b")).not.toBe(hash);
  });

  test("hashes the request IP from fly-client-ip and never returns the raw address", () => {
    const request = new Request("http://localhost/login", {
      headers: { "fly-client-ip": "198.51.100.23" },
    });
    const hash = hashRequestIp(request, DEV_IP_HASH_SALT);
    expect(hash).toBe(hashIP("198.51.100.23", DEV_IP_HASH_SALT));
    expect(hash).not.toContain("198.51.100.23");
    expect(getIpHashSalt().length).toBeGreaterThan(0);
  });
});
