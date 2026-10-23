import { expect, test } from "vitest";
import { createCSP } from "./csp.server.ts";

test("createCSP generates header with default directives", () => {
  const nonce = "abc123";
  const result = createCSP(nonce);

  expect(result).toContain("default-src 'none'");
  expect(result).toContain("frame-ancestors 'none'");
  expect(result).toContain("style-src-elem 'self'");
  expect(result).toContain("style-src-attr 'unsafe-inline'");
  expect(result).toContain("object-src 'none'");
  expect(result).toContain("base-uri 'none'");
  expect(result).toContain(
    "img-src 'self' data: blob: https://i.ytimg.com https://img.youtube.com",
  );
  expect(result).toContain(
    "connect-src 'self' https://*.ingest.sentry.io https://*.ingest.us.sentry.io",
  );
  expect(result).toContain("font-src 'self'");
  expect(result).toContain("manifest-src 'self'");
  expect(result).toContain(
    "media-src 'self' blob: https://fly.storage.tigris.dev https://*.fly.storage.tigris.dev",
  );
});

test("createCSP includes script-src with nonce and strict-dynamic (no 'self')", () => {
  const nonce = "def456";
  const result = createCSP(nonce);

  expect(result).toContain("script-src 'nonce-def456' 'strict-dynamic'");
  expect(result).not.toContain("script-src 'self'");
});

test("createCSP allows same-origin workers via worker-src", () => {
  const result = createCSP("abc123");

  expect(result).toContain("worker-src 'self'");
});

test("createCSP does not allow inline styles via a blanket style-src", () => {
  const result = createCSP("abc123");

  // The old blanket `style-src 'self' 'unsafe-inline'` must be gone: injected
  // <style> blocks are blocked (style-src-elem is 'self'), only inline style
  // *attributes* keep 'unsafe-inline' via style-src-attr.
  expect(result).not.toContain("style-src ");
});

test("createCSP handles empty nonce", () => {
  const result = createCSP("");

  expect(result).toContain("default-src 'none'");
  expect(result).toContain("script-src 'nonce-' 'strict-dynamic'");
  expect(result).toContain("frame-ancestors 'none'");
});

test("createCSP handles special characters in nonce", () => {
  const nonce = "a1b2c3d4e5f6=+/";
  const result = createCSP(nonce);

  expect(result).toContain("script-src 'nonce-a1b2c3d4e5f6=+/' 'strict-dynamic'");
});

test("createCSP allows vite HMR websockets in development", () => {
  const result = createCSP("abc123", { isDev: true });

  expect(result).toContain(
    "connect-src 'self' ws: wss: https://*.ingest.sentry.io https://*.ingest.us.sentry.io",
  );
});

test("createCSP joins directives with semicolon and space", () => {
  const result = createCSP("test");

  expect(result).toBe(
    "default-src 'none'; script-src 'nonce-test' 'strict-dynamic'; worker-src 'self'; style-src-elem 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data: blob: https://i.ytimg.com https://img.youtube.com; connect-src 'self' https://*.ingest.sentry.io https://*.ingest.us.sentry.io; font-src 'self'; media-src 'self' blob: https://fly.storage.tigris.dev https://*.fly.storage.tigris.dev; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
});
