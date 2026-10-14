/**
 * @vitest-environment jsdom
 *
 * Unit tests for the audio-queue admin page.
 * Pattern follows youtube-cookies.test.tsx.
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
import { consoleError } from "#tests/setup/setup-test-env.ts";
import { default as AudioQueueRoute, action, loader, ErrorBoundary } from "./audio-queue.tsx";

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

test("The audio-queue admin page renders all three sections", async () => {
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
          path: "admin/audio-queue",
          Component: AudioQueueRoute,
          ErrorBoundary,
          loader: async (args) => {
            args.request.headers.set("cookie", cookieHeader);
            return loader({ ...args, context: args.context });
          },
        },
      ],
    },
  ]);

  render(<App initialEntries={["/admin/audio-queue"]} />);

  await screen.findByRole("heading", { level: 1, name: /audio archive queue/i }, { timeout: 5000 });
  await screen.findByRole("heading", { level: 2, name: /worker control/i }, { timeout: 5000 });
  await screen.findByRole("heading", { level: 2, name: /track queue/i }, { timeout: 5000 });
});

test("The audio-queue admin page shows queue statistics", async () => {
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
          path: "admin/audio-queue",
          Component: AudioQueueRoute,
          ErrorBoundary,
          loader: async (args) => {
            args.request.headers.set("cookie", cookieHeader);
            return loader({ ...args, context: args.context });
          },
        },
      ],
    },
  ]);

  render(<App initialEntries={["/admin/audio-queue"]} />);

  // Stats cards should be visible. Some labels (Pending, Processing, etc.)
  // also appear as filter buttons, so use getAllByText and check count >= 1.
  await screen.findByText(/success rate/i, {}, { timeout: 5000 });
  expect(screen.getAllByText(/pending/i).length).toBeGreaterThanOrEqual(1);
  expect(screen.getAllByText(/processing/i).length).toBeGreaterThanOrEqual(1);
  expect(screen.getAllByText(/completed/i).length).toBeGreaterThanOrEqual(1);
  expect(screen.getAllByText(/failed/i).length).toBeGreaterThanOrEqual(1);
  expect(screen.getAllByText(/total/i).length).toBeGreaterThanOrEqual(1);
});

test("The audio-queue admin page shows worker status", async () => {
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
          path: "admin/audio-queue",
          Component: AudioQueueRoute,
          ErrorBoundary,
          loader: async (args) => {
            args.request.headers.set("cookie", cookieHeader);
            return loader({ ...args, context: args.context });
          },
        },
      ],
    },
  ]);

  render(<App initialEntries={["/admin/audio-queue"]} />);

  await screen.findByText(/running/i, {}, { timeout: 5000 });
  await screen.findByText(/currently processing/i, {}, { timeout: 5000 });
  await screen.findByText(/last queue run/i, {}, { timeout: 5000 });
  await screen.findByText(/last state change/i, {}, { timeout: 5000 });
});

test("The audio-queue admin page has filter buttons", async () => {
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
          path: "admin/audio-queue",
          Component: AudioQueueRoute,
          ErrorBoundary,
          loader: async (args) => {
            args.request.headers.set("cookie", cookieHeader);
            return loader({ ...args, context: args.context });
          },
        },
      ],
    },
  ]);

  render(<App initialEntries={["/admin/audio-queue"]} />);

  const buttons = await screen.findAllByRole("button", {}, { timeout: 5000 });
  const buttonTexts = buttons.map((b) => b.textContent?.trim());
  expect(buttonTexts.some((t) => t?.toLowerCase() === "all")).toBeTruthy();
  expect(buttonTexts.some((t) => t?.toLowerCase() === "pending")).toBeTruthy();
  expect(buttonTexts.some((t) => t?.toLowerCase() === "processing")).toBeTruthy();
  expect(buttonTexts.some((t) => t?.toLowerCase() === "completed")).toBeTruthy();
  expect(buttonTexts.some((t) => t?.toLowerCase() === "failed")).toBeTruthy();
});

test("Non-admin users get 403 error", async () => {
  // Suppress console.error for expected 403 error
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
          path: "admin/audio-queue",
          Component: AudioQueueRoute,
          ErrorBoundary,
          loader: async (args) => {
            args.request.headers.set("cookie", cookieHeader);
            return loader({ ...args, context: args.context });
          },
        },
      ],
    },
  ]);

  render(<App initialEntries={["/admin/audio-queue"]} />);

  await screen.findByText(/you must be an admin/i, {}, { timeout: 5000 });
});

const createdArtistIds: string[] = [];

async function createQueuedTrack(status: "failed" | "completed" | "processing" | "pending") {
  const service = await prisma.service.upsert({
    where: { name: "audio-queue-test" },
    update: {},
    create: {
      name: "audio-queue-test",
      displayName: "Audio Queue Test",
      baseUrl: "http://localhost",
      isActive: true,
    },
  });
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const artist = await prisma.artist.create({
    data: { name: "Queue Artist", normalizedName: `queue-artist-${suffix}` },
  });
  createdArtistIds.push(artist.id);
  const track = await prisma.track.create({
    data: {
      title: `Queued ${status} ${suffix}`,
      artistId: artist.id,
      serviceId: service.id,
      externalId: `audio-queue-${suffix}`,
    },
  });
  const job = await prisma.archiveJob.create({
    data: {
      trackId: track.id,
      status,
      priority: false,
      retryCount: 4,
      errorHistory: JSON.stringify([
        { category: "UNKNOWN", message: "boom", timestamp: "2026-01-01T00:00:00.000Z" },
      ]),
    },
  });
  return job;
}

async function cleanupQueuedTracks() {
  if (createdArtistIds.length === 0) return;
  await prisma.artist.deleteMany({ where: { id: { in: createdArtistIds } } });
  createdArtistIds.length = 0;
}

test("Retry all is hidden when no jobs have failed", async () => {
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
          path: "admin/audio-queue",
          Component: AudioQueueRoute,
          ErrorBoundary,
          loader: async (args) => {
            args.request.headers.set("cookie", cookieHeader);
            return loader({ ...args, context: args.context });
          },
        },
      ],
    },
  ]);

  render(<App initialEntries={["/admin/audio-queue"]} />);

  await screen.findByRole("heading", { level: 1, name: /audio archive queue/i }, { timeout: 5000 });
  expect(screen.queryByRole("button", { name: /retry all/i })).not.toBeInTheDocument();
});

test("Retry all requeues every failed job in one request", async () => {
  const failed = await createQueuedTrack("failed");
  const completed = await createQueuedTrack("completed");
  const processing = await createQueuedTrack("processing");

  try {
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
            path: "admin/audio-queue",
            Component: AudioQueueRoute,
            ErrorBoundary,
            loader: async (args) => {
              args.request.headers.set("cookie", cookieHeader);
              return loader({ ...args, context: args.context });
            },
          },
        ],
      },
    ]);

    render(<App initialEntries={["/admin/audio-queue"]} />);

    const retryAll = await screen.findByRole(
      "button",
      { name: /retry all \(\d+\)/i },
      { timeout: 5000 },
    );
    expect(retryAll).toHaveAttribute("name", "intent");
    expect(retryAll).toHaveAttribute("value", "retry-all-failed");

    const formData = new FormData();
    formData.set("intent", "retry-all-failed");
    const request = new Request("http://localhost/admin/audio-queue", {
      method: "POST",
      headers: { cookie: cookieHeader },
      body: formData,
    });
    const result = await action({
      request,
      params: {},
      context: {} as never,
    } as never);
    const payload = result && typeof result === "object" && "data" in result ? result.data : result;
    const body = payload as { success: boolean; action: string; count: number };
    expect(body.success).toBe(true);
    expect(body.action).toBe("retry-all-failed");
    expect(body.count).toBeGreaterThanOrEqual(1);

    const retried = await prisma.archiveJob.findUniqueOrThrow({ where: { id: failed.id } });
    expect(retried.status).toBe("pending");
    expect(retried.priority).toBe(true);
    expect(retried.retryCount).toBe(0);
    expect(retried.errorHistory).toBe("[]");

    const stillCompleted = await prisma.archiveJob.findUniqueOrThrow({
      where: { id: completed.id },
    });
    expect(stillCompleted.status).toBe("completed");
    expect(stillCompleted.retryCount).toBe(4);

    const stillProcessing = await prisma.archiveJob.findUniqueOrThrow({
      where: { id: processing.id },
    });
    expect(stillProcessing.status).toBe("processing");
    expect(stillProcessing.retryCount).toBe(4);
  } finally {
    await cleanupQueuedTracks();
  }
}, 20_000);
