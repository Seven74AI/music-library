/**
 * @vitest-environment jsdom
 */
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, test, vi } from "vitest";
import { authSessionStorage } from "#app/utils/session.server.ts";
import VerifyRoute, { action } from "./verify.tsx";
import {
  getPendingVerification,
  handleVerifyLoader,
  setPendingVerification,
  type VerifyLoaderData,
} from "./verify-pending.server.ts";

vi.mock("./verify.server.ts", () => ({
  validateRequest: vi.fn(async (_request: Request, body: FormData) => {
    return { received: Object.fromEntries(body.entries()) };
  }),
}));

function unwrapLoaderData(result: unknown): VerifyLoaderData {
  if (result && typeof result === "object" && "data" in result) {
    return (result as { data: VerifyLoaderData }).data;
  }
  return result as VerifyLoaderData;
}

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

  test("clean /verify loader exposes a marker only — never the OTP code", async () => {
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
    const data = unwrapLoaderData(await handleVerifyLoader(clean));
    expect(data).toEqual({
      hasPendingVerification: true,
      type: "2fa",
    });
    expect(JSON.stringify(data)).not.toContain("111111");
  });

  test("clean /verify HTML does not embed the session-held OTP", async () => {
    const withCode = new Request(
      "http://localhost/verify?code=999888&type=onboarding&target=user-9",
    );
    let setCookie: string | null = null;
    try {
      await handleVerifyLoader(withCode);
    } catch (response) {
      if (response instanceof Response) {
        setCookie = response.headers.get("Set-Cookie");
      }
    }
    expect(setCookie).toBeTruthy();

    const loaderData = unwrapLoaderData(
      await handleVerifyLoader(
        new Request("http://localhost/verify", { headers: { cookie: setCookie! } }),
      ),
    );

    const App = createRoutesStub([
      {
        path: "/verify",
        Component: VerifyRoute,
        loader: () => loaderData,
        action,
        HydrateFallback: () => null,
      },
    ]);

    render(createElement(App, { initialEntries: ["/verify"] }));
    await screen.findByText(/confirm to continue with your pending verification/i);
    expect(document.body.innerHTML).not.toContain("999888");
    expect(document.body.innerHTML).not.toMatch(/name=["']code["']/);
  });

  test("POST /verify reads code, target, and type from session — not the form", async () => {
    const session = await authSessionStorage.getSession();
    setPendingVerification(session, {
      code: "424242",
      type: "onboarding",
      target: "user-session",
      redirectTo: "/onboarding",
    });
    const cookie = await authSessionStorage.commitSession(session);
    const request = new Request("http://localhost/verify", {
      method: "POST",
      headers: {
        cookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code: "000000",
        type: "2fa",
        target: "attacker",
      }),
    });

    const response = await action({
      request,
      params: {},
      context: {},
    } as Parameters<typeof action>[0]);
    const { validateRequest } = await import("./verify.server.ts");
    expect(validateRequest).toHaveBeenCalled();
    expect(response).toMatchObject({
      received: {
        code: "424242",
        type: "onboarding",
        target: "user-session",
        redirectTo: "/onboarding",
      },
    });
  });
});
