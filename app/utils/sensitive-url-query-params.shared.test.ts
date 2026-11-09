import { describe, expect, test } from "vitest";
import {
  SENSITIVE_URL_QUERY_PARAMS,
  buildSensitiveUrlScrubInlineScript,
} from "./sensitive-url-query-params.shared.ts";

describe("buildSensitiveUrlScrubInlineScript", () => {
  test("returns an IIFE string that references all sensitive query param keys", () => {
    const script = buildSensitiveUrlScrubInlineScript();
    expect(script.startsWith("(function(){")).toBe(true);
    for (const key of SENSITIVE_URL_QUERY_PARAMS) {
      expect(script).toContain(JSON.stringify(key));
    }
  });
});
