import { describe, expect, test } from "vitest";
import {
  SENTRY_SENSITIVE_DATA_COLLECTION,
  stripSensitiveUrlQueryParams,
} from "./sentry-browser-init.ts";

describe("stripSensitiveUrlQueryParams", () => {
  test("removes OTP and OAuth params from hrefs", () => {
    const scrubbed = stripSensitiveUrlQueryParams(
      "/verify?code=654321&target=alice&state=xyz&foo=bar",
    );
    expect(scrubbed).not.toContain("code=");
    expect(scrubbed).not.toContain("target=");
    expect(scrubbed).not.toContain("state=");
    expect(scrubbed).toContain("foo=bar");
  });
});

describe("SENTRY_SENSITIVE_DATA_COLLECTION", () => {
  test("deny-lists sensitive query params for trace data collection", () => {
    expect(SENTRY_SENSITIVE_DATA_COLLECTION.urlQueryParams).toEqual({
      deny: ["code", "state", "target"],
    });
  });
});
