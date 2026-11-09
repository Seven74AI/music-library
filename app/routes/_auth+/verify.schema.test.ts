import { parseWithZod } from "@conform-to/zod/v4";
import { describe, expect, test } from "vitest";
import { SessionBackedVerifySchema, typeQueryParam } from "./verify.tsx";

describe("SessionBackedVerifySchema", () => {
  test("allows submit without a code field when type is present", () => {
    const formData = new FormData();
    formData.set(typeQueryParam, "onboarding");
    const result = parseWithZod(formData, { schema: SessionBackedVerifySchema });
    expect(result.status).toBe("success");
  });
});
