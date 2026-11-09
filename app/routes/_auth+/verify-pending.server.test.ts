/**
 * @vitest-environment jsdom
 */
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import * as verifyServer from "./verify.server.ts";
import VerifyRoute, { action } from "./verify.tsx";
import {
  getPendingVerification,
  handleVerifyLoader,
  setPendingVerification,
  type VerifyLoaderData,
} from "./verify-pending.server.ts";

const createdUserIds: string[] = [];

function request() {
  return new Request("http://localhost/login", {
    headers: { host: "localhost" },
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.verification.deleteMany({ where: { target: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds.length = 0;
});

function unwrapLoaderData(result: unknown): VerifyLoaderData {
  if (result && typeof result === "object" && "data" in result) {
    return (result as { data: VerifyLoaderData }).data;
  }
  return result as VerifyLoaderData;
}

describe("handleVerifyLoader", () => {
  test("GET /verify?code=X redirects to /verify without code in the URL and stores params in session", async () => {
    const user = await prisma.user.create({ data: createUser() });
    createdUserIds.push(user.id);
    const { otp } = await verifyServer.prepareVerification({
      period: 30,
      request: request(),
      type: "onboarding",
      target: user.id,
    });
    const verifyRequest = new Request(
      `http://localhost/verify?code=${otp}&type=onboarding&target=${user.id}&redirectTo=%2Fhome`,
    );

    let redirectResponse: Response | undefined;
    try {
      await handleVerifyLoader(verifyRequest);
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
      code: otp,
      type: "onboarding",
      target: user.id,
      redirectTo: "/home",
      linkExchanged: true,
    });

    const row = await prisma.verification.findUnique({
      where: { target_type: { target: user.id, type: "onboarding" } },
      select: { linkConsumedAt: true },
    });
    expect(row?.linkConsumedAt).toBeTruthy();
  });

  test("re-submitting a consumed OTP via GET does not restore pending session", async () => {
    const user = await prisma.user.create({ data: createUser() });
    createdUserIds.push(user.id);
    const { otp } = await verifyServer.prepareVerification({
      period: 30,
      request: request(),
      type: "onboarding",
      target: user.id,
    });
    const first = new Request(
      `http://localhost/verify?code=${otp}&type=onboarding&target=${user.id}`,
    );
    try {
      await handleVerifyLoader(first);
    } catch {
      // redirect
    }

    const replay = new Request(
      `http://localhost/verify?code=${otp}&type=onboarding&target=${user.id}`,
    );
    let setCookie: string | null = null;
    try {
      await handleVerifyLoader(replay);
    } catch (response) {
      if (response instanceof Response) {
        setCookie = response.headers.get("Set-Cookie");
      }
    }
    expect(setCookie).toBeFalsy();
  });

  test("clean /verify loader exposes a marker only — never the OTP code", async () => {
    const user = await prisma.user.create({ data: createUser() });
    createdUserIds.push(user.id);
    const { otp } = await verifyServer.prepareVerification({
      period: 30,
      request: request(),
      type: "onboarding",
      target: user.id,
    });
    const withCode = new Request(
      `http://localhost/verify?code=${otp}&type=onboarding&target=${user.id}`,
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

    const clean = new Request("http://localhost/verify", {
      headers: { cookie: setCookie! },
    });
    const data = unwrapLoaderData(await handleVerifyLoader(clean));
    expect(data).toEqual({
      hasPendingVerification: true,
      type: "onboarding",
    });
    expect(JSON.stringify(data)).not.toContain(otp);
  });

  test("clean /verify HTML does not embed the session-held OTP", async () => {
    const user = await prisma.user.create({ data: createUser() });
    createdUserIds.push(user.id);
    const { otp } = await verifyServer.prepareVerification({
      period: 30,
      request: request(),
      type: "onboarding",
      target: user.id,
    });
    const withCode = new Request(
      `http://localhost/verify?code=${otp}&type=onboarding&target=${user.id}`,
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
    expect(document.body.innerHTML).not.toContain(otp);
    expect(document.body.innerHTML).not.toMatch(/name=["']code["']/);
  });

  test("POST /verify reads code, target, and type from session — not the form", async () => {
    const user = await prisma.user.create({ data: createUser() });
    createdUserIds.push(user.id);
    await prisma.verification.create({
      data: {
        type: "onboarding",
        target: user.id,
        secret: "enc1:deadbeef",
        algorithm: "SHA-256",
        digits: 6,
        period: 600,
        charSet: "ABCDEFGHJKLMNPQRSTUVWXYZ123456789",
        linkConsumedAt: new Date(),
      },
    });
    const session = await authSessionStorage.getSession();
    setPendingVerification(session, {
      code: "424242",
      type: "onboarding",
      target: user.id,
      redirectTo: "/onboarding",
      linkExchanged: true,
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

    const validateSpy = vi
      .spyOn(verifyServer, "validateRequest")
      .mockImplementation(async (_request: Request, body: FormData | URLSearchParams) => {
        return { received: Object.fromEntries(body.entries()) } as never;
      });

    const response = await action({
      request,
      params: {},
      context: {},
    } as Parameters<typeof action>[0]);
    expect(validateSpy).toHaveBeenCalled();
    expect(response).toMatchObject({
      received: {
        code: "424242",
        type: "onboarding",
        target: user.id,
        redirectTo: "/onboarding",
      },
    });
  });
});
