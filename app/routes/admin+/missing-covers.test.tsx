/**
 * @vitest-environment jsdom
 *
 * Unit tests for the missing-covers admin page.
 */
import { File as NodeFile } from "node:buffer";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import undici from "undici";
import { parseString } from "set-cookie-parser";
import { expect, test, vi } from "vitest";
import { loader as rootLoader } from "#app/root.tsx";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { consoleError } from "#tests/setup/setup-test-env.ts";
import { action, default as MissingCoversRoute, loader, ErrorBoundary } from "./missing-covers.tsx";

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

test.skip("The missing-covers admin page renders", async () => {
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
          path: "admin/missing-covers",
          Component: MissingCoversRoute,
          ErrorBoundary,
          loader: async (args) => {
            args.request.headers.set("cookie", cookieHeader);
            return loader({ ...args, context: args.context });
          },
        },
      ],
    },
  ]);

  render(<App initialEntries={["/admin/missing-covers"]} />);

  await screen.findByRole(
    "heading",
    { level: 1, name: /admin cover management/i },
    { timeout: 5000 },
  );
  await screen.findByText(/tracks without covers/i, {}, { timeout: 5000 });
  await screen.findByText(/albums without covers/i, {}, { timeout: 5000 });
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
          path: "admin/missing-covers",
          Component: MissingCoversRoute,
          ErrorBoundary,
          loader: async (args) => {
            args.request.headers.set("cookie", cookieHeader);
            return loader({ ...args, context: args.context });
          },
        },
      ],
    },
  ]);

  render(<App initialEntries={["/admin/missing-covers"]} />);

  await screen.findByText(/you must be an admin/i, {}, { timeout: 5000 });
});

function actionPayload(result: unknown): { success?: boolean; error?: string } {
  if (result && typeof result === "object" && "data" in result) {
    return (result as { data: { success?: boolean; error?: string } }).data;
  }
  return (result ?? {}) as { success?: boolean; error?: string };
}

test("rejected album cover upload shows the action error", async () => {
  const user = userEvent.setup({ applyAccept: false });
  const cookieHeader = await createAdminSession();
  let actionResult: unknown;

  const App = createRoutesStub([
    {
      path: "/admin/missing-covers",
      Component: MissingCoversRoute,
      ErrorBoundary,
      HydrateFallback: () => null,
      loader: () => ({
        statistics: {
          totalTracks: 1,
          tracksWithCovers: 0,
          coveragePercentage: 0,
          serviceStats: [],
        },
        tracksCount: 0,
        albumsCount: 1,
        tracks: [],
        albums: [
          {
            id: "album-1",
            name: "Coverless Album",
            artistName: "Test Artist",
            artistId: "artist-1",
            trackCount: 1,
            tracksWithCovers: [],
            tracksWithCoverUrls: [],
            createdAt: new Date().toISOString(),
          },
        ],
        tab: "albums",
        page: 1,
        totalPages: 1,
      }),
      action: async (args) => {
        // The route checks `instanceof File`. jsdom and Node use different File classes,
        // and jsdom files cannot be parsed by Node's multipart decoder. Submit the same
        // rejected upload with Node's File so the real action runs.
        const originalFile = globalThis.File;
        vi.stubGlobal("File", NodeFile);
        try {
          const formData = new undici.FormData();
          formData.set("intent", "upload-album");
          formData.set("albumId", "album-1");
          formData.set(
            "file",
            new NodeFile([new Uint8Array([1, 2, 3])], "notes.txt", { type: "text/plain" }),
          );
          const request = new undici.Request(args.request.url, {
            method: "POST",
            headers: { cookie: cookieHeader },
            body: formData,
          });
          actionResult = await action({
            ...args,
            request: request as unknown as Request,
            context: args.context,
          });
          return actionResult;
        } finally {
          vi.stubGlobal("File", originalFile);
        }
      },
    },
  ]);

  render(<App initialEntries={["/admin/missing-covers?tab=albums"]} />);

  await screen.findByText("Coverless Album");
  const input = document.getElementById("upload-album-album-1");
  expect(input).toBeInstanceOf(HTMLInputElement);

  await user.upload(
    input as HTMLInputElement,
    new File([new Uint8Array([1, 2, 3])], "notes.txt", { type: "text/plain" }),
  );

  await waitFor(() => {
    expect(actionPayload(actionResult)).toEqual({
      success: false,
      error: "Invalid file type. Use JPG, PNG, WebP, or GIF",
    });
  });

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Invalid file type. Use JPG, PNG, WebP, or GIF",
  );
  expect(screen.getByText("Coverless Album")).toBeTruthy();
});
