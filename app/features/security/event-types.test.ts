import { expect, test } from "vitest";
import { securityEventLabel } from "./event-types.ts";

test("security events use a readable label", () => {
  expect(securityEventLabel("login_failed")).toBe("Failed login");
  expect(securityEventLabel("role_changed")).toBe("Role changed");
  expect(securityEventLabel("session_revoked")).toBe("Session revoked");
});
