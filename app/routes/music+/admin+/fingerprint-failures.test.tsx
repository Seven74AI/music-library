/**
 * @vitest-environment jsdom
 *
 * Unit tests for the fingerprint-failures admin page.
 * Pattern follows audio-queue.test.tsx / duplicates page style.
 */
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, createRoutesStub, RouterProvider } from "react-router";
import { parseString } from "set-cookie-parser";
import { beforeEach, expect, test, vi } from "vitest";
import { loader as rootLoader } from "#app/root.tsx";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { consoleError } from "#tests/setup/setup-test-env.ts";
import {
  default as FingerprintFailuresRoute,
  loader,
  ErrorBoundary,
} from "./fingerprint-failures.tsx";
import type { FingerprintFailuresLoaderData } from "#app/routes/api+/admin+/fingerprint-failures.tsx";

async function createAdminSession() {
  const user = await prisma.user.create({
    select: { id: true, username: true, name: true },
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
      userId: user.id,
    },
  });

  const authSession = await authSessionStorage.getSession();
  authSession.set(sessionKey, session.id);
  const setCookieHeader = await authSessionStorage.commitSession(authSession);
  const parsedCookie = parseString(setCookieHeader)!;
  return new URLSearchParams({
    [parsedCookie.name]: parsedCookie.value,
  }).toString();
}

function trustedOrigin() {
  const configured = process.env.SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return `http://127.0.0.1:${process.env.PORT || "3000"}`;
}

const emptyLoaderData: FingerprintFailuresLoaderData = {
  stats: {
    total: 0,
    withContentHash: 0,
    withAudioFingerprint: 0,
    fingerprintFailed: 0,
    unprocessed: 0,
    healthyPercent: 0,
  },
  failures: [],
  filters: { format: "all", service: "all", size: "all" },
  availableFormats: [],
  availableServices: [{ name: "local", displayName: "Local upload" }],
  page: 1,
  pageSize: 25,
  totalPages: 1,
  totalFailures: 0,
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(emptyLoaderData)) as unknown as typeof fetch,
  );
});

test("track title and View open the library track page", async () => {
  const failureRow: FingerprintFailuresLoaderData["failures"][number] = {
    id: "audio-file-1",
    trackId: "track-lovestory",
    title: "Lovestory",
    artist: "Meryl",
    objectKey: "audio/tracks/local/track-lovestory.flac",
    fileName: "lovestory.flac",
    format: "flac",
    mimeType: "audio/flac",
    fileSize: 1024,
    uploadedAt: "2026-01-01T00:00:00.000Z",
    serviceId: null,
    serviceName: "local",
    contentHash: "abc",
    audioFingerprint: null,
  };

  const router = createMemoryRouter(
    [
      {
        path: "/music/admin/fingerprint-failures",
        element: (
          <FingerprintFailuresRoute
            loaderData={{
              ...emptyLoaderData,
              failures: [failureRow],
              totalFailures: 1,
              stats: {
                ...emptyLoaderData.stats,
                total: 1,
                fingerprintFailed: 1,
              },
            }}
            params={{}}
            matches={[] as never}
          />
        ),
      },
    ],
    { initialEntries: ["/music/admin/fingerprint-failures"] },
  );

  render(<RouterProvider router={router} />);

  expect(await screen.findByRole("link", { name: "Lovestory" })).toHaveAttribute(
    "href",
    "/library/track-lovestory",
  );
  expect(screen.getByRole("link", { name: "View" })).toHaveAttribute(
    "href",
    "/library/track-lovestory",
  );
  expect(screen.queryByRole("columnheader", { name: "Audio ID" })).not.toBeInTheDocument();
  expect(screen.queryByText(/audio-file/)).not.toBeInTheDocument();
});

test("The fingerprint-failures admin page renders heading and stats", async () => {
  const cookieHeader = await createAdminSession();

  const App = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: async (args) => {
        args.request.headers.set("cookie", cookieHeader);
        return rootLoader({ ...args, context: args.context });
      },
      HydrateFallback: () => <div>Loading...</div>,
      children: [
        {
          path: "music/admin/fingerprint-failures",
          Component: FingerprintFailuresRoute,
          ErrorBoundary,
          loader: async (args) => {
            args.request.headers.set("cookie", cookieHeader);
            return loader({ ...args, context: args.context });
          },
        },
      ],
    },
  ]);

  render(<App initialEntries={["/music/admin/fingerprint-failures"]} />);

  await screen.findByRole(
    "heading",
    { level: 1, name: /fingerprint failures/i },
    { timeout: 5000 },
  );
  await screen.findByText(/total audio files/i, {}, { timeout: 5000 });
  expect(screen.getByText(/with content hash/i)).toBeTruthy();
  expect(screen.getByText(/with fingerprint/i)).toBeTruthy();
  expect(screen.getByText(/fingerprint failed/i)).toBeTruthy();
  expect(screen.getByText(/unprocessed/i)).toBeTruthy();
  expect(screen.getByText(/% healthy/i)).toBeTruthy();
});

test("The fingerprint-failures admin page shows empty state", async () => {
  const cookieHeader = await createAdminSession();

  const App = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: async (args) => {
        args.request.headers.set("cookie", cookieHeader);
        return rootLoader({ ...args, context: args.context });
      },
      HydrateFallback: () => <div>Loading...</div>,
      children: [
        {
          path: "music/admin/fingerprint-failures",
          Component: FingerprintFailuresRoute,
          ErrorBoundary,
          loader: async (args) => {
            args.request.headers.set("cookie", cookieHeader);
            return loader({ ...args, context: args.context });
          },
        },
      ],
    },
  ]);

  render(<App initialEntries={["/music/admin/fingerprint-failures"]} />);

  await screen.findByText(/no fingerprint failures/i, {}, { timeout: 5000 });
});

test("Non-admin users get 403 error", async () => {
  consoleError.mockImplementation(() => {});

  const user = await prisma.user.create({
    select: { id: true, username: true, name: true },
    data: createUser(),
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
  const setCookieHeader = await authSessionStorage.commitSession(authSession);
  const parsedCookie = parseString(setCookieHeader)!;
  const cookieHeader = new URLSearchParams({
    [parsedCookie.name]: parsedCookie.value,
  }).toString();

  const App = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: async (args) => {
        args.request.headers.set("cookie", cookieHeader);
        return rootLoader({ ...args, context: args.context });
      },
      HydrateFallback: () => <div>Loading...</div>,
      children: [
        {
          path: "music/admin/fingerprint-failures",
          Component: FingerprintFailuresRoute,
          ErrorBoundary,
          loader: async (args) => {
            args.request.headers.set("cookie", cookieHeader);
            return loader({ ...args, context: args.context });
          },
        },
      ],
    },
  ]);

  render(<App initialEntries={["/music/admin/fingerprint-failures"]} />);

  await screen.findByText(/you must be an admin/i, {}, { timeout: 5000 });
});

test("fingerprint-failures lookup uses a trusted origin and only the session cookie", async () => {
  const cookieHeader = await createAdminSession();
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    Response.json(emptyLoaderData),
  );
  vi.stubGlobal("fetch", fetchMock);

  const request = new Request(
    "http://evil.example/music/admin/fingerprint-failures?format=flac&page=2",
    {
      headers: {
        cookie: `${cookieHeader}; theme=dark`,
        authorization: "Bearer leaked-token",
        "x-forwarded-host": "evil.example",
      },
    },
  );

  await loader({ request, url: new URL(request.url) } as never);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [fetchedUrl, init] = fetchMock.mock.calls[0]!;
  expect(String(fetchedUrl)).toBe(
    `${trustedOrigin()}/api/admin/fingerprint-failures?format=flac&page=2`,
  );
  const headers = new Headers(init?.headers);
  expect(headers.get("cookie")).toBe(cookieHeader);
  expect(headers.get("authorization")).toBeNull();
  expect(headers.get("x-forwarded-host")).toBeNull();
});
