import { describe, expect, test } from "vitest";
import { requestUrlForAccessLog } from "../server/request-log-url.ts";

describe("requestUrlForAccessLog", () => {
  test("drops query string so verify OTP codes never appear in access logs", () => {
    const logged = requestUrlForAccessLog("/verify?code=123456&target=kody&type=reset-password");
    expect(logged).toBe("/verify");
    expect(logged).not.toContain("code=");
    expect(logged).not.toContain("target=");
  });

  test("drops hash fragments", () => {
    expect(requestUrlForAccessLog("/library#section")).toBe("/library");
  });

  test("decodes percent-encoded paths before stripping query", () => {
    expect(requestUrlForAccessLog("%2Fverify%3Fcode%3D1")).toBe("/verify");
  });
});
