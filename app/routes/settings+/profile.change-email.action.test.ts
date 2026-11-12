import { afterEach, describe, expect, test, vi } from "vitest";
import { consoleError } from "#tests/setup/setup-test-env.ts";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { VERIFICATION_EMAIL_CLIENT_ERROR_MESSAGE } from "#app/utils/error-handlers.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { convertSetCookieToCookie } from "#tests/utils.ts";
import { action } from "./profile.change-email.tsx";

const createdUserIds: string[] = [];

async function createAccount() {
  const user = await prisma.user.create({ data: createUser() });
  createdUserIds.push(user.id);
  return user;
}

async function authCookieForUser(userId: string) {
  const session = await prisma.session.create({
    data: {
      userId,
      expirationDate: getSessionExpirationDate(),
    },
    select: { id: true },
  });
  const authSession = await authSessionStorage.getSession();
  authSession.set(sessionKey, session.id);
  return convertSetCookieToCookie(await authSessionStorage.commitSession(authSession));
}

function changeEmailRequest(cookie: string, email: string) {
  const form = new FormData();
  form.set("email", email);
  return new Request("http://localhost/settings/profile/change-email", {
    method: "POST",
    headers: { cookie, host: "localhost" },
    body: form,
  });
}

function callAction(request: Request) {
  return action({
    request,
    params: {},
    context: {} as never,
    url: new URL(request.url),
    pattern: "/settings/profile/change-email",
  });
}

afterEach(async () => {
  const userIds = createdUserIds.splice(0);
  if (userIds.length === 0) return;
  await prisma.verification.deleteMany({ where: { target: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("change-email action", () => {
  test("does not expose Resend upstream text when sendEmail fails", async () => {
    consoleError.mockImplementation(() => {});
    const user = await createAccount();
    const cookie = await authCookieForUser(user.id);
    const pendingEmail = `new-${user.id}@example.com`;

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          name: "application_error",
          message: "Resend upstream secret failure",
          statusCode: 503,
        }),
        { status: 503 },
      ),
    );

    try {
      const result = await callAction(changeEmailRequest(cookie, pendingEmail));
      expect(result).toMatchObject({
        type: "DataWithResponseInit",
        init: { status: 500 },
      });
      const serialized = JSON.stringify(result);
      expect(serialized).toContain(VERIFICATION_EMAIL_CLIENT_ERROR_MESSAGE);
      expect(serialized).not.toContain("Resend");
      expect(serialized).not.toContain("upstream secret");
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
