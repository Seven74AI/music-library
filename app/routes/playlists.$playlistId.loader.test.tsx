import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getUserIdOrNull, requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { createTrack } from "#tests/db-utils.ts";
import { action, loader } from "./playlists.$playlistId.tsx";

vi.mock("#app/utils/auth.server.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#app/utils/auth.server.ts")>()),
  getUserIdOrNull: vi.fn(),
  requireUserId: vi.fn(),
}));

type Visibility = "PRIVATE" | "PUBLIC" | "UNLISTED";

const userIds: string[] = [];
const trackIds: string[] = [];

afterEach(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.track.deleteMany({ where: { id: { in: trackIds } } });
  userIds.length = 0;
  trackIds.length = 0;
});

beforeEach(() => {
  vi.mocked(getUserIdOrNull).mockResolvedValue(null);
});

async function setup(visibility: Visibility) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const owner = await prisma.user.create({
    data: {
      email: `o-${suffix}@example.com`,
      username: `o${suffix}`.slice(0, 20),
      name: "Olive",
    },
  });
  const viewer = await prisma.user.create({
    data: {
      email: `v-${suffix}@example.com`,
      username: `v${suffix}`.slice(0, 20),
    },
  });
  userIds.push(owner.id, viewer.id);
  const track = await createTrack(`T ${suffix}`);
  trackIds.push(track.id);
  await prisma.trackAudioFile.create({
    data: {
      trackId: track.id,
      serviceId: track.serviceId,
      format: "mp3",
      objectKey: `secret-${suffix}`,
    },
  });
  const playlist = await prisma.userPlaylist.create({
    data: {
      title: `PL ${suffix}`,
      description: "desc",
      ownerId: owner.id,
      visibility,
      tracks: { create: { trackId: track.id, position: 0 } },
    },
  });
  return { owner, viewer, playlist };
}

function callLoader(playlistId: string) {
  return loader({
    request: new Request(`http://localhost/playlists/${playlistId}`),
    params: { playlistId },
  } as never);
}

async function expect404(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({ status: 404 });
}

function unwrap(result: unknown) {
  return ((result as { data?: unknown }).data ?? result) as Record<string, unknown>;
}

describe("playlists.$playlistId loader", () => {
  test("404 for an unknown playlist", async () => {
    await expect404(callLoader("nope"));
  });

  test("owner gets editor data plus visibility", async () => {
    const { owner, playlist } = await setup("PRIVATE");
    vi.mocked(getUserIdOrNull).mockResolvedValue(owner.id);
    const result = unwrap(await callLoader(playlist.id));
    expect(result.isOwner).toBe(true);
    expect(result.playlists).toBeDefined();
    expect(result.playlist).toMatchObject({
      id: playlist.id,
      visibility: "PRIVATE",
    });
  });

  test.each(["PUBLIC", "UNLISTED"] as const)(
    "non-owner gets a read-only payload for a %s playlist",
    async (visibility) => {
      const { viewer, playlist } = await setup(visibility);
      vi.mocked(getUserIdOrNull).mockResolvedValue(viewer.id);
      const result = unwrap(await callLoader(playlist.id));
      expect(result.isOwner).toBe(false);
      expect(result).not.toHaveProperty("playlists");
      const pl = result.playlist as {
        title: string;
        tracks: Array<{
          track: { audioFiles: Array<Record<string, unknown>> };
        }>;
        owner: { username: string };
      };
      expect(pl.title).toBe(playlist.title);
      expect(pl.owner.username).toBeTruthy();
      expect(pl.tracks).toHaveLength(1);
      expect(pl.tracks[0]!.track.audioFiles[0]).not.toHaveProperty("objectKey");
    },
  );

  test("non-owner gets 404 for a PRIVATE playlist", async () => {
    const { viewer, playlist } = await setup("PRIVATE");
    vi.mocked(getUserIdOrNull).mockResolvedValue(viewer.id);
    await expect404(callLoader(playlist.id));
  });

  test.each(["PUBLIC", "UNLISTED"] as const)(
    "anonymous can read a %s playlist",
    async (visibility) => {
      const { playlist } = await setup(visibility);
      const result = unwrap(await callLoader(playlist.id));
      expect(result.isOwner).toBe(false);
      expect(result.isLoggedIn).toBe(false);
    },
  );

  test("anonymous gets 404 for a PRIVATE playlist", async () => {
    const { playlist } = await setup("PRIVATE");
    await expect404(callLoader(playlist.id));
  });
});

describe("playlists.$playlistId update-visibility action", () => {
  function callAction(playlistId: string, visibility: string) {
    const fd = new FormData();
    fd.append("intent", "update-visibility");
    fd.append("visibility", visibility);
    return action({
      request: new Request(`http://localhost/playlists/${playlistId}`, {
        method: "POST",
        body: fd,
      }),
      params: { playlistId },
    } as never);
  }

  test("owner can change visibility", async () => {
    const { owner, playlist } = await setup("PRIVATE");
    vi.mocked(requireUserId).mockResolvedValue(owner.id);
    await callAction(playlist.id, "PUBLIC");
    const row = await prisma.userPlaylist.findUniqueOrThrow({
      where: { id: playlist.id },
    });
    expect(row.visibility).toBe("PUBLIC");
  });

  test("a non-owner cannot change another user's playlist and does not 500", async () => {
    const { viewer, playlist } = await setup("PRIVATE");
    vi.mocked(requireUserId).mockResolvedValue(viewer.id);
    await expect(callAction(playlist.id, "PUBLIC")).resolves.toBeDefined();
    const row = await prisma.userPlaylist.findUniqueOrThrow({
      where: { id: playlist.id },
    });
    expect(row.visibility).toBe("PRIVATE");
  });

  test("a missing playlist does not 500", async () => {
    const { owner } = await setup("PRIVATE");
    vi.mocked(requireUserId).mockResolvedValue(owner.id);
    await expect(callAction("does-not-exist", "PUBLIC")).resolves.toBeDefined();
  });

  test("rejects an invalid visibility value with 400", async () => {
    const { owner, playlist } = await setup("PRIVATE");
    vi.mocked(requireUserId).mockResolvedValue(owner.id);
    const result = await callAction(playlist.id, "EVERYONE");
    expect(result).toMatchObject({ init: { status: 400 } });
  });
});
