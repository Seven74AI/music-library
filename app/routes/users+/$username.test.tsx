/**
 * @vitest-environment jsdom
 */
import { faker } from "@faker-js/faker";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { parseString } from "set-cookie-parser";
import { describe, expect, test, vi } from "vitest";
import { loader as rootLoader } from "#app/root.tsx";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createTrack, createUser, getUserImages } from "#tests/db-utils.ts";
import { default as UsernameRoute, loader } from "./$username.tsx";

// Playback is owner-gated; these tests only assert rendering, so stub the player.
vi.mock("#app/components/audio-player-provider.tsx", () => ({
  useAudioPlayer: () => ({
    currentTrack: null,
    isPlaying: false,
    pauseTrack: vi.fn(),
    resumeTrack: vi.fn(),
    playPlaylist: vi.fn(),
  }),
}));

test("The user profile when not logged in as self", async () => {
  const userImages = await getUserImages();
  const userImage = userImages[faker.number.int({ min: 0, max: userImages.length - 1 })];
  const user = await prisma.user.create({
    select: { id: true, username: true, name: true },
    data: { ...createUser(), image: { create: userImage } },
  });
  const App = createRoutesStub([
    {
      path: "/users/:username",
      Component: UsernameRoute,
      loader,
      HydrateFallback: () => <div>Loading...</div>,
    },
  ]);

  const routeUrl = `/users/${user.username}`;
  render(<App initialEntries={[routeUrl]} />);

  await screen.findByRole("heading", { level: 1, name: user.name! }, { timeout: 5000 });
  await screen.findByRole("img", { name: user.name! }, { timeout: 5000 });
});

test("The user profile when logged in as self", async () => {
  const userImages = await getUserImages();
  const userImage = userImages[faker.number.int({ min: 0, max: userImages.length - 1 })];
  const user = await prisma.user.create({
    select: { id: true, username: true, name: true },
    data: { ...createUser(), image: { create: userImage } },
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
        // add the cookie header to the request
        args.request.headers.set("cookie", cookieHeader);
        return rootLoader({ ...args, context: args.context });
      },
      HydrateFallback: () => <div>Loading...</div>,
      children: [
        {
          path: "users/:username",
          Component: UsernameRoute,
          loader: async (args) => {
            // add the cookie header to the request
            args.request.headers.set("cookie", cookieHeader);
            return loader(args);
          },
        },
      ],
    },
  ]);

  const routeUrl = `/users/${user.username}`;
  render(<App initialEntries={[routeUrl]} />);

  await screen.findByRole("heading", { level: 1, name: user.name! }, { timeout: 5000 });
  await screen.findByRole("img", { name: user.name! }, { timeout: 5000 });
  await screen.findByRole("button", { name: /logout/i }, { timeout: 5000 });
  await screen.findByRole("link", { name: /edit profile/i }, { timeout: 5000 });
});

// ---------------------------------------------------------------------------
// Profile stats + per-block privacy
// ---------------------------------------------------------------------------

async function seedListener() {
  const user = await prisma.user.create({
    select: { id: true, username: true, name: true },
    data: createUser(),
  });
  const track = await createTrack("Profile Hit");
  await prisma.userTrack.create({ data: { userId: user.id, trackId: track.id } });
  for (let i = 0; i < 3; i++) {
    await prisma.usageEvent.create({
      data: { type: "play_completed", userId: user.id, trackId: track.id },
    });
  }
  return { user, track };
}

function callLoader(username: string) {
  const request = new Request(`http://localhost/users/${username}`);
  return loader({ params: { username }, request, context: {} as never } as never);
}

describe("profile loader privacy (data-time omission)", () => {
  test("missing ProfilePrivacy row means all blocks public", async () => {
    const { user } = await seedListener();
    const result = await callLoader(user.username);
    expect(result.topTracks).toHaveLength(1);
    expect(result.topArtists).toHaveLength(1);
    expect(result.totals).toMatchObject({ plays: 3, librarySize: 1 });
    expect(result.heavyRotation).toHaveLength(1);
    expect(result.recentlyPlayed).toHaveLength(1);
  });

  test.each([
    ["showTopTracks", "topTracks"],
    ["showTopArtists", "topArtists"],
    ["showTotals", "totals"],
    ["showHeavyRotation", "heavyRotation"],
    ["showRecentlyPlayed", "recentlyPlayed"],
  ] as const)("%s=false omits %s from the loader return value", async (toggle, key) => {
    const { user } = await seedListener();
    await prisma.profilePrivacy.create({ data: { userId: user.id, [toggle]: false } });
    const result = await callLoader(user.username);
    expect(result).not.toHaveProperty(key);
    // visitors never learn which blocks are hidden
    expect(result).not.toHaveProperty("hiddenBlocks");
    // the other blocks still come through
    for (const other of [
      "topTracks",
      "topArtists",
      "totals",
      "heavyRotation",
      "recentlyPlayed",
    ].filter((k) => k !== key)) {
      expect(result).toHaveProperty(other);
    }
  });
});

describe("profile stats UI", () => {
  function renderProfile(username: string, cookie?: string) {
    const App = createRoutesStub([
      {
        id: "root",
        path: "/",
        loader: async (args) => {
          if (cookie) args.request.headers.set("cookie", cookie);
          return rootLoader({ ...args, context: args.context });
        },
        HydrateFallback: () => <div>Loading...</div>,
        children: [
          {
            path: "users/:username",
            Component: UsernameRoute,
            loader: async (args) => {
              if (cookie) args.request.headers.set("cookie", cookie);
              return loader(args);
            },
          },
        ],
      },
    ]);
    return render(<App initialEntries={[`/users/${username}`]} />);
  }

  async function sessionCookie(userId: string) {
    const session = await prisma.session.create({
      select: { id: true },
      data: { expirationDate: getSessionExpirationDate(), userId },
    });
    const authSession = await authSessionStorage.getSession();
    authSession.set(sessionKey, session.id);
    const parsed = parseString(await authSessionStorage.commitSession(authSession))!;
    return new URLSearchParams({ [parsed.name]: parsed.value }).toString();
  }

  test("visitor sees enabled blocks, and nothing for hidden ones", async () => {
    const { user } = await seedListener();
    await prisma.profilePrivacy.create({ data: { userId: user.id, showTopArtists: false } });
    renderProfile(user.username);

    await screen.findByRole("heading", { level: 2, name: /top tracks/i }, { timeout: 5000 });
    expect(screen.getAllByText("Profile Hit").length).toBeGreaterThan(0);
    // totals now live in the header as a stat row (no standalone heading)
    expect(screen.getByText("Completed plays")).toBeInTheDocument();
    expect(screen.getByText("Library size")).toBeInTheDocument();
    expect(screen.getByText("Listening time")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /top artists/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/hidden from visitors/i)).not.toBeInTheDocument();
  });

  test("visitor sees heavy rotation and recently played cards when enabled", async () => {
    const { user } = await seedListener();
    renderProfile(user.username);

    await screen.findByRole("heading", { level: 2, name: /heavy rotation/i }, { timeout: 5000 });
    expect(screen.getByRole("heading", { level: 2, name: /recently played/i })).toBeInTheDocument();
    // one card per section (tracks without audio render as "(archiving)")
    expect(screen.getAllByRole("button", { name: /profile hit by artist/i })).toHaveLength(2);
    // profile-specific: no strip links
    expect(screen.queryByRole("link", { name: /view all/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /view history/i })).not.toBeInTheDocument();
  });

  test("visitor sees nothing for disabled heavy rotation / recently played", async () => {
    const { user } = await seedListener();
    await prisma.profilePrivacy.create({
      data: { userId: user.id, showHeavyRotation: false, showRecentlyPlayed: false },
    });
    renderProfile(user.username);

    await screen.findByRole("heading", { level: 2, name: /top tracks/i }, { timeout: 5000 });
    expect(screen.queryByRole("heading", { name: /heavy rotation/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /recently played/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/hidden from visitors/i)).not.toBeInTheDocument();
  });

  test("owner sees placeholders for disabled heavy rotation / recently played", async () => {
    const { user } = await seedListener();
    await prisma.profilePrivacy.create({
      data: { userId: user.id, showHeavyRotation: false, showRecentlyPlayed: false },
    });
    renderProfile(user.username, await sessionCookie(user.id));

    await screen.findByText(/heavy rotation: hidden from visitors/i, undefined, {
      timeout: 5000,
    });
    expect(screen.getByText(/recently played: hidden from visitors/i)).toBeInTheDocument();
  });

  test("owner sees a 'hidden from visitors' placeholder for hidden blocks", async () => {
    const { user } = await seedListener();
    await prisma.profilePrivacy.create({ data: { userId: user.id, showTotals: false } });
    renderProfile(user.username, await sessionCookie(user.id));

    await screen.findByText(/totals: hidden from visitors/i, undefined, { timeout: 5000 });
    expect(screen.queryByText("Completed plays")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /top tracks/i })).toBeInTheDocument();
  });

  test("a user with no data shows no empty sections", async () => {
    const user = await prisma.user.create({
      select: { id: true, username: true, name: true },
      data: createUser(),
    });
    renderProfile(user.username);
    await screen.findByRole("heading", { level: 1, name: user.name! }, { timeout: 5000 });
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
  });
});
