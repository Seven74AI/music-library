import { describe, expect, test } from "vitest";
// Plain ESM helpers loaded by instrument.server.mjs at runtime (no TS emit).
// @ts-expect-error — companion types live next to the .mjs module for tests only.
import { scrubSensitiveSentryTransaction } from "./sentry-sensitive-scrub.mjs";

describe("scrubSensitiveSentryTransaction", () => {
  test("scrubs OTP params from a sampled transaction Referer and span header attributes", () => {
    const referer = "http://localhost/verify?code=654321&type=2fa&target=alice&state=oauth";
    const transaction = {
      type: "transaction",
      request: {
        headers: { referer },
        url: "http://localhost/verify?code=654321&target=alice",
      },
      spans: [
        {
          data: {
            "http.request.header.referer": [referer],
            "request.headers.referer": referer,
            "headers.referer": referer,
          },
        },
      ],
    };

    const scrubbed = scrubSensitiveSentryTransaction(structuredClone(transaction));

    expect(scrubbed.request?.headers?.referer).not.toContain("code=");
    expect(scrubbed.request?.headers?.referer).not.toContain("target=");
    expect(scrubbed.request?.headers?.referer).not.toContain("state=");
    expect(scrubbed.request?.headers?.referer).toContain("type=2fa");

    const spanData = scrubbed.spans?.[0]?.data as Record<string, unknown>;
    for (const key of [
      "http.request.header.referer",
      "request.headers.referer",
      "headers.referer",
    ]) {
      const serialized = JSON.stringify(spanData[key]);
      expect(serialized).not.toContain("code=");
      expect(serialized).not.toContain("target=");
      expect(serialized).not.toContain("state=");
    }
  });
});
