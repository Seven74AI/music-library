import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { cache } from "#app/utils/cache.server.ts";
import { action } from "./cache_.sqlite.server.ts";
import { middleware } from "./_layout.tsx";

const token = process.env.INTERNAL_COMMAND_TOKEN;
const keys = new Set<string>();

function entry(value: unknown) {
  return {
    metadata: { createdTime: 1_700_000_000_000, ttl: 60_000, swr: 0 },
    value,
  };
}

function cacheRequest(key: string, authorization?: string) {
  keys.add(key);
  const headers = new Headers({ "content-type": "application/json" });
  if (authorization) headers.set("authorization", authorization);
  return new Request("http://localhost/admin/cache/sqlite", {
    method: "POST",
    headers,
    body: JSON.stringify({ key, cacheValue: entry({ marker: key }) }),
  });
}

afterEach(async () => {
  await Promise.all([...keys].map((key) => cache.delete(key)));
  keys.clear();
});

async function runAction(request: Request) {
  const invoke = () => action({ request, params: {}, context: {} } as never);
  if (middleware?.[0]) {
    return middleware[0](
      {
        request,
        params: {},
        context: {} as never,
        url: new URL(request.url),
        pattern: "/admin/cache/sqlite",
      },
      invoke,
    );
  }
  return invoke();
}

test("valid bearer still updates the cache", async () => {
  const key = "admin-cache-valid-bearer";
  const request = cacheRequest(key, `Bearer ${token}`);
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

  const result = await runAction(request);

  expect(result).toEqual({ success: true });
  await expect(cache.get(key)).resolves.toMatchObject({ value: { marker: key } });
  const output = [log, info, debug].flatMap((spy) => spy.mock.calls.flat().map(String)).join("\n");
  expect(output.includes(token ?? "INTERNAL_COMMAND_TOKEN")).toBe(false);
  log.mockRestore();
  info.mockRestore();
  debug.mockRestore();
});

test("bearer comparison uses timingSafeEqual on equal-length buffers", () => {
  const source = readFileSync(new URL("./cache_.sqlite.server.ts", import.meta.url), "utf8");
  expect(source).toContain("timingSafeEqual");
  expect(source).toMatch(/\.length !== .*\.length/);
  expect(source.includes("=== `Bearer ${token}`")).toBe(false);
});

test("invalid bearer does not update the cache", async () => {
  const key = "admin-cache-invalid-bearer";
  const wrong =
    token && token.length > 0 ? `Bearer ${"x".repeat(token.length)}` : "Bearer wrong-token";
  const request = cacheRequest(key, wrong);

  const result = await runAction(request);

  expect(result).toMatchObject({ data: { error: "Unauthorized" }, init: { status: 401 } });
  await expect(cache.get(key)).resolves.toBeNull();
});

test("a missing bearer does not update the cache", async () => {
  const key = "admin-cache-missing-bearer";
  const request = cacheRequest(key);

  const result = await runAction(request);

  expect(result).toMatchObject({ data: { error: "Unauthorized" }, init: { status: 401 } });
  await expect(cache.get(key)).resolves.toBeNull();
});

test("a different-length bearer does not throw or update the cache", async () => {
  const key = "admin-cache-short-bearer";
  const request = cacheRequest(key, "Bearer nope");

  const result = await runAction(request);

  expect(result).toMatchObject({ data: { error: "Unauthorized" }, init: { status: 401 } });
  await expect(cache.get(key)).resolves.toBeNull();
});
