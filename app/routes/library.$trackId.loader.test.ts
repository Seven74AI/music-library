import { describe, expect, test, vi, beforeEach } from "vitest";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { loader } from "./library.$trackId.tsx";

vi.mock("#app/utils/auth.server.ts", () => ({
  requireUserId: vi.fn(),
}));

describe("library.$trackId loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("omits audio file object keys when the viewer does not own the track", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await prisma.user.create({
      data: {
        email: `lib-detail-${suffix}@test.com`,
        username: `lib-detail-${suffix}`,
      },
    });
    const service = await prisma.service.create({
      data: {
        name: `lib-detail-svc-${suffix}`,
        displayName: "Detail Test",
        baseUrl: "https://example.com",
      },
    });
    const artist = await prisma.artist.create({
      data: {
        name: "Detail Artist",
        normalizedName: `detail artist ${suffix}`,
      },
    });
    const track = await prisma.track.create({
      data: {
        title: "Unowned Detail Track",
        externalId: `ext-${suffix}`,
        serviceId: service.id,
        artistId: artist.id,
        audioFiles: {
          create: {
            serviceId: service.id,
            objectKey: `audio/tracks/${service.name}/${suffix}.mp3`,
            format: "mp3",
          },
        },
      },
    });

    vi.mocked(requireUserId).mockResolvedValue(user.id);

    const response = await loader({
      request: new Request(`http://localhost/library/${track.id}`),
      params: { trackId: track.id },
    } as never);

    const payload = (response as { data: unknown }).data as {
      track: { audioFiles: Array<{ objectKey?: string }> };
      isInUserLibrary: boolean;
    };

    expect(payload.isInUserLibrary).toBe(false);
    expect(payload.track.audioFiles).toEqual([]);
  });
});
