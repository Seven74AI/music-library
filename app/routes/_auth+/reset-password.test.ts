import { faker } from "@faker-js/faker";
import { afterEach, describe, expect, test } from "vitest";
import { verifyUserPassword } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import {
  createPasswordResetGrantForUser,
  hashPasswordResetGrantToken,
} from "#app/utils/password-reset-grant.server.ts";
import { verifySessionStorage } from "#app/utils/verification.server.ts";
import { createPassword, createUser } from "#tests/db-utils.ts";
import { handleVerification } from "./reset-password.server.ts";
import {
  resetPasswordGrantTokenSessionKey,
  resetPasswordUsernameSessionKey,
} from "./reset-password.tsx";
import { action } from "./reset-password.tsx";

const createdUserIds: string[] = [];

async function createAccount() {
  const { hash } = createPassword("original-password-123");
  const user = await prisma.user.create({
    data: { ...createUser(), password: { create: { hash } } },
  });
  createdUserIds.push(user.id);
  return user;
}

async function buildVerifyCookie(values: Record<string, unknown>) {
  const verifySession = await verifySessionStorage.getSession();
  for (const [key, value] of Object.entries(values)) {
    verifySession.set(key, value);
  }
  return verifySessionStorage.commitSession(verifySession);
}

function resetPasswordRequest(cookie: string, password: string) {
  const form = new FormData();
  form.set("password", password);
  form.set("confirmPassword", password);
  return new Request("http://localhost/reset-password", {
    method: "POST",
    body: form,
    headers: { cookie },
  });
}

function toResponse(result: unknown): Response {
  if (result instanceof Response) return result;
  if (
    typeof result === "object" &&
    result !== null &&
    "type" in result &&
    (result as { type: string }).type === "DataWithResponseInit"
  ) {
    const { data, init } = result as unknown as { data: unknown; init: ResponseInit | null };
    return new Response(JSON.stringify(data), init ?? undefined);
  }
  throw new Error(`Unexpected action result: ${String(result)}`);
}

async function callAction(request: Request): Promise<Response> {
  try {
    return toResponse(
      await action({
        request,
        params: {},
        context: {} as never,
        url: new URL(request.url),
        pattern: "/reset-password",
      }),
    );
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}

afterEach(async () => {
  await prisma.passwordResetGrant.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds.length = 0;
});

describe("reset-password action", () => {
  test("rejects a copied verification cookie after the grant was consumed", async () => {
    const user = await createAccount();
    const { token } = await createPasswordResetGrantForUser(user.id);
    const cookie = await buildVerifyCookie({
      [resetPasswordUsernameSessionKey]: user.username,
      [resetPasswordGrantTokenSessionKey]: token,
    });

    const firstPassword = faker.internet.password({ length: 24 });
    const firstResponse = await callAction(resetPasswordRequest(cookie, firstPassword));
    expect(firstResponse).toHaveRedirect("/login");

    const replayResponse = await callAction(resetPasswordRequest(cookie, "another-password-456"));
    expect(replayResponse.status).toBe(400);

    expect(await verifyUserPassword({ username: user.username }, firstPassword)).toEqual({
      id: user.id,
    });
    expect(
      await verifyUserPassword({ username: user.username }, "another-password-456"),
    ).toBeNull();
  });

  test("a fresh verification issues a new grant and allows one successful reset", async () => {
    const user = await createAccount();
    const grantResult = await handleVerification({
      request: new Request("http://localhost/verify"),
      submission: {
        status: "success",
        value: { target: user.username },
      } as never,
      body: new FormData(),
    });
    const grantResponse = toResponse(grantResult);

    expect(grantResponse).toHaveRedirect("/reset-password");
    const setCookie = grantResponse.headers
      .getSetCookie()
      .find((cookie: string) => cookie.startsWith("en_verification="));
    expect(setCookie).toBeDefined();

    const grantCount = await prisma.passwordResetGrant.count({ where: { userId: user.id } });
    expect(grantCount).toBe(1);

    const newPassword = faker.internet.password({ length: 24 });
    const resetResponse = await callAction(
      resetPasswordRequest(
        // Re-commit is unnecessary; use the set-cookie from the redirect as the Cookie header value.
        await convertVerificationSetCookieToCookieHeader(setCookie!),
        newPassword,
      ),
    );
    expect(resetResponse).toHaveRedirect("/login");
    expect(await verifyUserPassword({ username: user.username }, newPassword)).toEqual({
      id: user.id,
    });

    await expect(prisma.passwordResetGrant.count({ where: { userId: user.id } })).resolves.toBe(0);
  });
});

async function convertVerificationSetCookieToCookieHeader(setCookie: string) {
  const { parseString } = await import("set-cookie-parser");
  const parsed = parseString(setCookie);
  if (!parsed) {
    throw new Error("Failed to parse verification set-cookie");
  }
  return new URLSearchParams({ [parsed.name]: parsed.value }).toString();
}

describe("password reset grant storage", () => {
  test("stores only a SHA-256 hash of the grant token", async () => {
    const user = await createAccount();
    const { token } = await createPasswordResetGrantForUser(user.id);

    const row = await prisma.passwordResetGrant.findFirst({ where: { userId: user.id } });
    expect(row).not.toBeNull();
    expect(row!.tokenHash).toBe(hashPasswordResetGrantToken(token));
    expect(row!.tokenHash).not.toBe(token);
  });
});
