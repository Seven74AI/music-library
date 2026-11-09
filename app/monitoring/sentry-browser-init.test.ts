import { describe, expect, test } from "vitest";
import {
  SENTRY_SENSITIVE_DATA_COLLECTION,
  scrubReplayRecordingEvent,
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

describe("scrubReplayRecordingEvent", () => {
  test("strips sensitive query params from replay breadcrumb urls", () => {
    const scrubbed = scrubReplayRecordingEvent({
      type: 5,
      timestamp: 0,
      data: {
        tag: "breadcrumb",
        payload: {
          type: "default",
          timestamp: 0,
          category: "ui.slowClickDetected",
          data: {
            url: "https://app.example/verify?code=secret&target=user",
          },
        },
      },
    } as never);
    const url = (scrubbed.data as { payload: { data: { url: string } } }).payload.data.url;
    expect(url).not.toContain("code=");
    expect(url).not.toContain("target=");
  });
});

describe("SENTRY_SENSITIVE_DATA_COLLECTION", () => {
  test("deny-lists sensitive query params for trace data collection", () => {
    expect(SENTRY_SENSITIVE_DATA_COLLECTION.urlQueryParams).toEqual({
      deny: ["code", "state", "target"],
    });
  });
});
