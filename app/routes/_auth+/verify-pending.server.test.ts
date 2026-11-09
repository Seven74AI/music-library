import { describe, expect, test } from "vitest";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { getPendingVerification, handleVerifyLoader } from "./verify-pending.server.ts";

describe("handleVerifyLoader", () => {
  test("GET /verify?code=X redirects to /verify without code in the URL and stores params in session", async () => {
    const request = new Request(
      "http://localhost/verify?code=654321&type=onboarding&target=user-1&redirectTo=%2Fhome",
    );

    let redirectResponse: Response | undefined;
    try {
      await handleVerifyLoader(request);
    } catch (response) {
      if (response instanceof Response) {
        redirectResponse = response;
      } else {
        throw response;
      }
    }

    expect(redirectResponse).toBeDefined();
    expect(redirectResponse!.status).toBe(302);
    const location = redirectResponse!.headers.get("Location");
    expect(location).toBeTruthy();
    expect(location).not.toContain("code=");
    expect(new URL(location!, "http://localhost").pathname).toBe("/verify");

    const setCookie = redirectResponse!.headers.get("Set-Cookie");
    expect(setCookie).toBeTruthy();
    const session = await authSessionStorage.getSession(setCookie);
    expect(getPendingVerification(session)).toEqual({
      code: "654321",
      type: "onboarding",
      target: "user-1",
      redirectTo: "/home",
    });
  });

  test("clean /verify loader returns pending params from session", async () => {
    const withCode = new Request("http://localhost/verify?code=111111&type=2fa&target=user-2");
    let setCookie: string | null = null;
    try {
      await handleVerifyLoader(withCode);
    } catch (response) {
      if (response instanceof Response) {
        setCookie = response.headers.get("Set-Cookie");
      }
    }
    expect(setCookie).toBeTruthy();

    const clean = new Request("http://localhost/verify", {
      headers: { cookie: setCookie! },
    });
    const loaderResult = await handleVerifyLoader(clean);
    const data =
      loaderResult && typeof loaderResult === "object" && "data" in loaderResult
        ? (loaderResult as { data: { pendingVerification: unknown } }).data
        : loaderResult;
    expect(data.pendingVerification).toEqual({
      code: "111111",
      type: "2fa",
      target: "user-2",
    });
  });
});
