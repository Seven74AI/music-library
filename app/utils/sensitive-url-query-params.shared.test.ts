import { describe, expect, test } from "vitest";
import {
  SENSITIVE_URL_QUERY_PARAMS,
  stripSensitiveUrlQueryParams,
} from "./sensitive-url-query-params.shared.ts";

describe("stripSensitiveUrlQueryParams", () => {
  test("removes sensitive query keys from verify URLs", () => {
    const scrubbed = stripSensitiveUrlQueryParams(
      "/verify?code=654321&type=onboarding&target=user-1&foo=bar",
    );
    expect(scrubbed).not.toContain("code=");
    expect(scrubbed).not.toContain("target=");
    expect(scrubbed).toContain("type=onboarding");
    expect(scrubbed).toContain("foo=bar");
    for (const key of SENSITIVE_URL_QUERY_PARAMS) {
      expect(scrubbed).not.toContain(`${key}=`);
    }
  });
});
