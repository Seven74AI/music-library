import { describe, expect, test } from "vitest";
import { consoleError } from "#tests/setup/setup-test-env.ts";
import { action } from "./authentication.ts";

describe("webauthn authentication action", () => {
  test("does not return raw Error.message for unexpected failures", async () => {
    consoleError.mockImplementation(() => {});

    const request = new Request("http://localhost/webauthn/authentication", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "" },
      body: JSON.stringify({
        authResponse: {
          id: "missing",
          rawId: "missing",
          response: {
            clientDataJSON: "e30",
            authenticatorData: "e30",
            signature: "e30",
          },
          type: "public-key",
          clientExtensionResults: {},
        },
        remember: false,
        redirectTo: null,
      }),
    });

    const response = await action({
      request,
      params: {},
      context: {} as never,
      url: new URL(request.url),
      pattern: "/webauthn/authentication",
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { status: string; error: string };
    expect(body.status).toBe("error");
    expect(body.error).toBe("Authentication challenge not found");
    expect(body.error).not.toMatch(/cookie/i);
  });
});
