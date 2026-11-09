import type { ErrorEvent, ReplayEvent } from "@sentry/core";
import { describe, expect, test } from "vitest";
import {
  SENTRY_SENSITIVE_DATA_COLLECTION,
  scrubReplayRecordingEvent,
  scrubSentryEvent,
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
    const url = (scrubbed!.data as { payload: { data: { url: string } } }).payload.data.url;
    expect(url).not.toContain("code=");
    expect(url).not.toContain("target=");
  });

  test("strips sensitive query params from rrweb Meta href", () => {
    const scrubbed = scrubReplayRecordingEvent({
      type: 4,
      timestamp: 1_234,
      data: {
        href: "https://app.example/verify?code=otp-secret&state=oauth&foo=bar",
        width: 1920,
        height: 1080,
      },
    });
    const href = (scrubbed!.data as { href: string }).href;
    expect(href).not.toContain("code=");
    expect(href).not.toContain("state=");
    expect(href).toContain("foo=bar");
  });

  test("strips navigation.push performance span destination and previous urls", () => {
    const scrubbed = scrubReplayRecordingEvent({
      type: 5,
      timestamp: 0,
      data: {
        tag: "performanceSpan",
        payload: {
          op: "navigation.push",
          description: "/verify?code=secret&target=user",
          startTimestamp: 0,
          endTimestamp: 0,
          data: {
            previous: "/login?code=old&state=xyz",
          },
        },
      },
    } as never);
    const payload = (
      scrubbed!.data as { payload: { description: string; data: { previous: string } } }
    ).payload;
    expect(payload.description).not.toContain("code=");
    expect(payload.description).not.toContain("target=");
    expect(payload.data.previous).not.toContain("code=");
    expect(payload.data.previous).not.toContain("state=");
  });

  test("strips sensitive params from replay urls arrays", () => {
    const scrubbed = scrubReplayRecordingEvent({
      type: "replay_event",
      urls: [
        "https://app.example/verify?code=one",
        "https://app.example/home",
        "/path?state=two&ok=1",
      ],
    } as never);
    const urls = (scrubbed! as { urls: string[] }).urls;
    expect(urls[0]).not.toContain("code=");
    expect(urls[1]).toBe("https://app.example/home");
    expect(urls[2]).not.toContain("state=");
    expect(urls[2]).toContain("ok=1");
  });
});

describe("scrubSentryEvent", () => {
  test("strips sensitive query params from replay_event urls", () => {
    const scrubbed = scrubSentryEvent({
      type: "replay_event",
      urls: ["https://app.example/verify?code=otp&target=user"],
      event_id: "abc",
    } as unknown as ErrorEvent);
    expect((scrubbed as ReplayEvent).urls[0]).not.toContain("code=");
    expect((scrubbed as ReplayEvent).urls[0]).not.toContain("target=");
  });
});

describe("SENTRY_SENSITIVE_DATA_COLLECTION", () => {
  test("deny-lists sensitive query params for trace data collection", () => {
    expect(SENTRY_SENSITIVE_DATA_COLLECTION.urlQueryParams).toEqual({
      deny: ["code", "state", "target"],
    });
  });
});
