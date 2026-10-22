/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { parseString } from "set-cookie-parser";
import { expect, test } from "vitest";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { consoleError } from "#tests/setup/setup-test-env.ts";
import { loader as adminIndexLoader } from "./index.tsx";
import { default as AdminLayout, ErrorBoundary, loader, middleware } from "./_layout.tsx";

async function createSessionCookie({ admin }: { admin: boolean }) {
  const user = await prisma.user.create({
    select: { id: true },
    data: {
      ...createUser(),
      roles: admin
        ? {
            connectOrCreate: {
              where: { name: "admin" },
              create: { name: "admin" },
            },
          }
        : undefined,
    },
  });
  const session = await prisma.session.create({
    select: { id: true },
    data: {
      expirationDate: getSessionExpirationDate(),
      userId: user.id,
    },
  });
  const authSession = await authSessionStorage.getSession();
  authSession.set(sessionKey, session.id);
  const parsedCookie = parseString(await authSessionStorage.commitSession(authSession))!;
  return `${parsedCookie.name}=${parsedCookie.value}`;
}

function adminPageRequest(cookie?: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (cookie) headers.set("cookie", cookie);
  headers.set("accept", "text/html");
  headers.set("sec-fetch-dest", "document");
  headers.set("sec-fetch-mode", "navigate");
  return new Request("http://localhost/admin", { ...init, headers });
}

function load(request: Request) {
  return Promise.resolve().then(() => loader({ request }));
}

test("non-admin session gets 403 from an admin page", async () => {
  consoleError.mockImplementation(() => {});
  const cookie = await createSessionCookie({ admin: false });
  const request = adminPageRequest(cookie);

  await expect(load(request)).rejects.toMatchObject({
    init: { status: 403 },
    data: { requiredRole: "admin" },
  });

  const App = createRoutesStub([
    {
      path: "/admin",
      loader: async (args) => {
        args.request.headers.set("cookie", cookie);
        return loader(args);
      },
      Component: AdminLayout,
      ErrorBoundary,
      HydrateFallback: () => null,
      children: [
        {
          index: true,
          Component: () => <h1>Admin page</h1>,
        },
      ],
    },
  ]);

  render(<App initialEntries={["/admin"]} />);

  expect(await screen.findByText(/you must be an admin/i)).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Admin page" })).not.toBeInTheDocument();
});

test("admin session still loads an admin page", async () => {
  const cookie = await createSessionCookie({ admin: true });
  const request = adminPageRequest(cookie);

  await expect(load(request)).resolves.toMatchObject({ data: {} });

  const page = await adminIndexLoader({
    request,
    params: {},
    context: {} as never,
    url: new URL(request.url),
    pattern: "/admin",
  });
  expect(page.totals.users).toBeGreaterThanOrEqual(1);

  const App = createRoutesStub([
    {
      path: "/admin",
      loader: async (args) => {
        args.request.headers.set("cookie", cookie);
        return loader(args);
      },
      Component: AdminLayout,
      ErrorBoundary,
      HydrateFallback: () => null,
      children: [
        {
          index: true,
          Component: () => <h1>Admin page</h1>,
        },
      ],
    },
  ]);

  render(<App initialEntries={["/admin"]} />);
  expect(await screen.findByRole("heading", { name: "Admin page" })).toBeInTheDocument();
});

test("a document request under /admin without a session does not load", async () => {
  const request = adminPageRequest();

  await expect(load(request)).rejects.toBeInstanceOf(Response);
  try {
    await load(request);
  } catch (error) {
    const response = error as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/login");
  }
});

test("replica cache post without a session is not rejected by the layout", async () => {
  const request = new Request("http://localhost/admin/cache/sqlite", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.INTERNAL_COMMAND_TOKEN}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ key: "replica", cacheValue: { value: 1 } }),
  });

  await expect(load(request)).resolves.toMatchObject({ data: {} });

  expect(middleware.length).toBeGreaterThan(0);
  let continued = false;
  await middleware[0]!(
    {
      request,
      params: {},
      context: {} as never,
      url: new URL(request.url),
      pattern: "/admin/cache/sqlite",
    },
    async () => {
      continued = true;
    },
  );
  expect(continued).toBe(true);
});

test("a non-admin session cookie on the cache command still gets 403", async () => {
  const cookie = await createSessionCookie({ admin: false });
  const request = new Request("http://localhost/admin/cache/sqlite", {
    method: "POST",
    headers: {
      cookie,
      authorization: `Bearer ${process.env.INTERNAL_COMMAND_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ key: "session-cookie", cacheValue: { value: 1 } }),
  });

  await expect(load(request)).rejects.toMatchObject({
    init: { status: 403 },
  });
  await expect(
    middleware[0]!(
      {
        request,
        params: {},
        context: {} as never,
        url: new URL(request.url),
        pattern: "/admin/cache/sqlite",
      },
      async () => {
        throw new Error("session-cookie calls still require the admin role");
      },
    ),
  ).rejects.toMatchObject({ init: { status: 403 } });
});
