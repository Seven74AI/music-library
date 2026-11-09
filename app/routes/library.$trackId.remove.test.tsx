import { describe, expect, test, vi, beforeEach } from "vitest";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { action } from "./library.$trackId.remove";

vi.mock("#app/utils/auth.server.ts", () => ({
  requireUserId: vi.fn(),
}));

describe("library.$trackId.remove action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("soft-deletes the user track and returns data without redirect", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await prisma.user.create({
      data: {
        email: `remove-action-${suffix}@test.com`,
        username: `remove-action-${suffix}`,
      },
    });
    const service = await prisma.service.create({
      data: {
        name: `remove-svc-${suffix}`,
        displayName: "Remove Test",
        baseUrl: "https://example.com",
      },
    });
    const artist = await prisma.artist.create({
      data: {
        name: "Remove Artist",
        normalizedName: `remove artist ${suffix}`,
      },
    });
    const track = await prisma.track.create({
      data: {
        title: "Remove Me",
        externalId: `ext-${suffix}`,
        serviceId: service.id,
        artistId: artist.id,
      },
    });
    await prisma.userTrack.create({
      data: {
        userId: user.id,
        trackId: track.id,
        isActive: true,
      },
    });

    vi.mocked(requireUserId).mockResolvedValue(user.id);

    const response = await action({
      request: new Request(`http://localhost/library/${track.id}/remove`, { method: "POST" }),
      params: { trackId: track.id },
    } as never);

    const updated = await prisma.userTrack.findUnique({
      where: { userId_trackId: { userId: user.id, trackId: track.id } },
    });

    expect(updated).not.toBeNull();
    expect(updated?.isActive).toBe(false);
    expect(updated?.deletedAt).not.toBeNull();
    expect(response).toMatchObject({
      data: { status: "success" },
    });
    expect(response).not.toBeInstanceOf(Response);
  });
});
