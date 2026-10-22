/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  QUEUE_CACHE_ENABLED_KEY_PREFIX,
  isQueueCacheEnabled,
  setQueueCacheEnabled,
} from "./queue-cache-preference.client.ts";

afterEach(() => {
  window.localStorage.clear();
});

test("isQueueCacheEnabled defaults to true when nothing is stored", () => {
  expect(isQueueCacheEnabled("user-1")).toBe(true);
});

test("setQueueCacheEnabled persists false and isQueueCacheEnabled reads it", () => {
  setQueueCacheEnabled("user-1", false);
  expect(window.localStorage.getItem(`${QUEUE_CACHE_ENABLED_KEY_PREFIX}user-1`)).toBe("false");
  expect(isQueueCacheEnabled("user-1")).toBe(false);
});

test("setQueueCacheEnabled persists true", () => {
  setQueueCacheEnabled("user-1", false);
  setQueueCacheEnabled("user-1", true);
  expect(isQueueCacheEnabled("user-1")).toBe(true);
});

test("preference is isolated per userId", () => {
  setQueueCacheEnabled("user-a", false);
  setQueueCacheEnabled("user-b", true);
  expect(isQueueCacheEnabled("user-a")).toBe(false);
  expect(isQueueCacheEnabled("user-b")).toBe(true);
});

test("isQueueCacheEnabled returns true for invalid stored values", () => {
  window.localStorage.setItem(`${QUEUE_CACHE_ENABLED_KEY_PREFIX}user-1`, "maybe");
  expect(isQueueCacheEnabled("user-1")).toBe(true);
});

describe("edge cases: SSR, empty userId, quota exceeded", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("isQueueCacheEnabled returns true when window is undefined (SSR)", () => {
    vi.stubGlobal("window", undefined);
    expect(isQueueCacheEnabled("user-1")).toBe(true);
  });

  test("setQueueCacheEnabled does not throw when window is undefined (SSR)", () => {
    vi.stubGlobal("window", undefined);
    expect(() => setQueueCacheEnabled("user-1", false)).not.toThrow();
  });

  test("isQueueCacheEnabled returns true for empty userId", () => {
    expect(isQueueCacheEnabled("")).toBe(true);
  });

  test("setQueueCacheEnabled does not throw when localStorage is full", () => {
    window.localStorage.setItem = vi.fn().mockImplementation(() => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    });
    expect(() => setQueueCacheEnabled("user-1", false)).not.toThrow();
  });
});
