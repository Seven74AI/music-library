import { describe, expect, test } from "vitest";
import {
  SENSITIVE_URL_QUERY_PARAMS,
  redactSensitiveSentryRequestHeaders,
  stripSensitiveUrlQueryParams,
} from "./sensitive-url-query-params.shared.ts";

describe("stripSensitiveUrlQueryParams", () => {
  test("removes sensitive query keys from verify URLs", () => {
    const scrubbed = stripSensitiveUrlQueryParams(
      "/verify?code=654321&type=onboarding&target=user-1&foo=bar",
    );
    expect(scrubbed).not.toContain("code=");
    expect(scrubbed).not.toContain("target=");
    for (const key of SENSITIVE_URL_QUERY_PARAMS) {
      expect(scrubbed).not.toContain(`${key}=`);
    }
    expect(scrubbed).toContain("type=onboarding");
    expect(scrubbed).toContain("foo=bar");
  });
});

describe("redactSensitiveSentryRequestHeaders", () => {
  test("redacts verify OTP params from Referer", () => {
    const headers = redactSensitiveSentryRequestHeaders({
      referer: "http://localhost/verify?code=654321&type=2fa&target=user-1",
      "user-agent": "vitest",
    });
    expect(headers?.referer).not.toContain("code=");
    expect(headers?.referer).not.toContain("target=");
    expect(headers?.["user-agent"]).toBe("vitest");
  });
});
