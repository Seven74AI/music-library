/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { parseString } from "set-cookie-parser";
import { test, expect } from "vitest";
import { loader as rootLoader } from "#app/root.tsx";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import {
  action,
  default as AdminUserDetailRoute,
  describeEventMeta,
  loader,
} from "./users_.$userId.tsx";

async function createAdminSession() {
  const admin = await prisma.user.create({
    select: { id: true },
    data: {
      ...createUser(),
      roles: {
        connectOrCreate: {
          where: { name: "admin" },
          create: { name: "admin" },
        },
      },
    },
  });
  // Ensure a second admin so demote/delete of others can succeed in other tests
  await prisma.user.create({
    data: {
      ...createUser(),
      roles: {
        connectOrCreate: {
          where: { name: "admin" },
          create: { name: "admin" },
        },
      },
    },
  });
  const session = await prisma.session.create({
    select: { id: true },
    data: {
      expirationDate: getSessionExpirationDate(),
      userId: admin.id,
    },
  });

  const authSession = await authSessionStorage.getSession();
  authSession.set(sessionKey, session.id);
  const setCookieHeader = await authSessionStorage.commitSession(authSession);
  const parsedCookie = parseString(setCookieHeader)!;
  return {
    adminId: admin.id,
    cookie: new URLSearchParams({
      [parsedCookie.name]: parsedCookie.value,
    }).toString(),
  };
}

test("admin user detail renders moderation controls", async () => {
  const { cookie } = await createAdminSession();
  const target = await prisma.user.create({
    data: {
      ...createUser(),
      roles: { connect: { name: "user" } },
    },
  });

  const App = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: async (args) => {
        args.request.headers.set("cookie", cookie);
        return rootLoader({ ...args, context: args.context });
      },
      HydrateFallback: () => <div>Loading...</div>,
      children: [
        {
          path: "admin/users/:userId",
          Component: AdminUserDetailRoute,
          loader: async (args) => {
            args.request.headers.set("cookie", cookie);
            return loader({
              ...args,
              params: { userId: target.id },
              context: args.context,
            });
          },
        },
      ],
    },
  ]);

  render(<App initialEntries={[`/admin/users/${target.id}`]} />);

  await screen.findByRole("heading", { level: 1, name: target.username }, { timeout: 5000 });
  await screen.findByRole("button", { name: /disable account/i }, { timeout: 5000 });
  await screen.findByRole("button", { name: /promote to admin/i }, { timeout: 5000 });
});

function runAction(cookie: string, userId: string, fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  const request = new Request(`http://localhost/admin/users/${userId}`, {
    method: "POST",
    headers: { cookie },
    body: formData,
  });
  return action({
    request,
    params: { userId },
    context: {} as never,
    url: new URL(request.url),
    pattern: "/admin/users/:userId",
  });
}

function errorOf(response: unknown) {
  return (response as { data?: { error?: string }; init?: { status?: number } }) ?? {};
}

async function createTargetUser() {
  return prisma.user.create({
    data: { ...createUser(), roles: { connect: { name: "user" } } },
  });
}

test("disable action sets disabledAt and redirects back to the detail page", async () => {
  const { cookie } = await createAdminSession();
  const target = await createTargetUser();

  const response = await runAction(cookie, target.id, { intent: "disable" });

  expect(response).toBeInstanceOf(Response);
  expect((response as Response).status).toBe(302);
  expect((response as Response).headers.get("Location")).toBe(`/admin/users/${target.id}`);

  const updated = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
  expect(updated.disabledAt).not.toBeNull();
});

test("disable action refuses to disable the acting admin", async () => {
  const { cookie, adminId } = await createAdminSession();

  const response = await runAction(cookie, adminId, { intent: "disable" });

  expect(errorOf(response).init?.status).toBe(400);
  expect(errorOf(response).data?.error).toBe("You cannot disable your own account");

  const actor = await prisma.user.findUniqueOrThrow({ where: { id: adminId } });
  expect(actor.disabledAt).toBeNull();
});

test("delete action refuses a mismatched username confirmation", async () => {
  const { cookie } = await createAdminSession();
  const target = await createTargetUser();

  const response = await runAction(cookie, target.id, {
    intent: "delete",
    confirmUsername: "definitely-not-the-username",
  });

  expect(errorOf(response).init?.status).toBe(400);
  expect(errorOf(response).data?.error).toBe("Type the username exactly to confirm deletion");
  expect(await prisma.user.findUnique({ where: { id: target.id } })).not.toBeNull();
});

test("delete action removes the user when the username matches", async () => {
  const { cookie } = await createAdminSession();
  const target = await createTargetUser();

  const response = await runAction(cookie, target.id, {
    intent: "delete",
    confirmUsername: target.username,
  });

  expect((response as Response).headers.get("Location")).toBe("/admin/users");
  expect(await prisma.user.findUnique({ where: { id: target.id } })).toBeNull();
});

test("action rejects an unknown intent", async () => {
  const { cookie } = await createAdminSession();
  const target = await createTargetUser();

  const response = await runAction(cookie, target.id, { intent: "launch-missiles" });

  expect(errorOf(response).init?.status).toBe(400);
  expect(errorOf(response).data?.error).toBe("Unknown intent: launch-missiles");
});

test("action returns 404 when moderating a user that no longer exists", async () => {
  const { cookie } = await createAdminSession();

  const response = await runAction(cookie, "no-such-user", { intent: "enable" });

  expect(errorOf(response).init?.status).toBe(404);
  expect(errorOf(response).data?.error).toBe("User not found");
});

test.each([
  ["bulk library add", JSON.stringify({ count: 12 }), "+12 tracks"],
  ["single-track bulk add", JSON.stringify({ count: 1 }), "+1 track"],
  ["unrecognised JSON", JSON.stringify({ reason: "ended" }), JSON.stringify({ reason: "ended" })],
  ["no meta", null, null],
])("describeEventMeta renders %s", (_label, meta, expected) => {
  expect(describeEventMeta(meta)).toBe(expected);
});
