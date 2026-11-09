import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "./email.server.ts";

describe("sendEmail without RESEND_API_KEY", () => {
  const originalResend = process.env.RESEND_API_KEY;
  const originalMocks = process.env.MOCKS;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.MOCKS;
  });

  afterEach(() => {
    if (originalResend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalResend;
    if (originalMocks === undefined) delete process.env.MOCKS;
    else process.env.MOCKS = originalMocks;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
  });

  it("logs the full email body (including OTP) in development", async () => {
    process.env.NODE_ENV = "development";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendEmail({
      to: "user@example.com",
      subject: "Verify your account",
      html: "<p>Your code is 654321</p>",
      text: "Your code is 654321",
    });

    expect(result.status).toBe("success");
    const logged = errorSpy.mock.calls.flat().join("\n");
    expect(logged).toContain("654321");
    expect(logged).toContain("user@example.com");
    expect(logged).toContain("Verify your account");
  });

  it("does not report success in production", async () => {
    process.env.NODE_ENV = "production";
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      sendEmail({
        to: "user@example.com",
        subject: "Password reset",
        html: "<p>OTP 111222</p>",
        text: "OTP 111222",
      }),
    ).rejects.toThrow(/RESEND_API_KEY/i);
  });
});
