import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server";
import { createUser } from "#tests/db-utils";
import { consoleError } from "#tests/setup/setup-test-env.ts";
import { confirmOrphanedMatches } from "./orphaned-match-confirm.server";
import { getServiceByName } from "./playlist-utils.server";

vi.mock("./playlist-utils.server", () => ({
  getServiceByName: vi.fn(),
}));

describe("confirmOrphanedMatches server faults", () => {
  beforeEach(async () => {
    await prisma.servicePlaylistTrack.deleteMany();
    await prisma.servicePlaylist.deleteMany();
    await prisma.track.deleteMany();
    await prisma.artist.deleteMany();
    await prisma.user.deleteMany();
  });

  test("service lookup failure returns success:false instead of throwing", async () => {
    consoleError.mockImplementation(() => {});
    vi.mocked(getServiceByName).mockRejectedValue(new Error("db down"));
    const user = await prisma.user.create({ data: createUser() });
    const service = await prisma.service.upsert({
      where: { name: "youtube" },
      update: {},
      create: {
        name: "youtube",
        displayName: "YouTube",
        baseUrl: "https://youtube.com",
      },
    });
    const playlist = await prisma.servicePlaylist.create({
      data: {
        serviceId: service.id,
        externalId: "PL-fault",
        title: "Fault",
        itemCount: 0,
        ownerId: user.id,
      },
    });

    const result = await confirmOrphanedMatches(
      playlist.id,
      [
        {
          deletedItemId: "i1",
          selectedTrackId: null,
          position: 1,
          action: "new",
        },
      ],
      user.id,
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("Failed to process matches");
    expect(result.error).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("db down");
  });

  test("match to a track not in the playlist returns the specific domain error", async () => {
    consoleError.mockImplementation(() => {});
    const user = await prisma.user.create({ data: createUser() });
    const service = await prisma.service.upsert({
      where: { name: "youtube" },
      update: {},
      create: { name: "youtube", displayName: "YouTube", baseUrl: "https://youtube.com" },
    });
    vi.mocked(getServiceByName).mockResolvedValue(service);
    const playlist = await prisma.servicePlaylist.create({
      data: {
        serviceId: service.id,
        externalId: "PL-orphan",
        title: "Orphan",
        itemCount: 0,
        ownerId: user.id,
      },
    });

    const result = await confirmOrphanedMatches(
      playlist.id,
      [{ action: "match", selectedTrackId: "not-a-member", position: 1 }],
      user.id,
    );

    expect(result).toEqual({
      success: false,
      processedCount: 0,
      message: "Track is not a member of this playlist: not-a-member",
      error: "Track is not a member of this playlist: not-a-member",
    });
  });
});
