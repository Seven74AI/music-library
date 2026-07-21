import { describe, expect, test } from "vitest";
import { TOAST_ICON_BY_VARIANT } from "./toast.tsx";

describe("TOAST_ICON_BY_VARIANT", () => {
  test("uses check icon for success", () => {
    expect(TOAST_ICON_BY_VARIANT.success).toBe("check-circled");
  });

  test("uses neutral icon for default messages", () => {
    expect(TOAST_ICON_BY_VARIANT.default).toBe("file-text");
  });

  test("uses x icon for errors and destructive actions", () => {
    expect(TOAST_ICON_BY_VARIANT.error).toBe("x-mark");
    expect(TOAST_ICON_BY_VARIANT.destructive).toBe("x-mark");
  });
});
