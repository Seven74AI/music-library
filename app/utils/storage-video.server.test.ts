import { Readable } from "node:stream";
import { describe, expect, test } from "vitest";
import { deleteUnreferencedVideoObjectKeys } from "#app/features/track-video/video-cleanup.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import {
  VideoUploadTooLargeError,
  buildVideoObjectKey,
  isVideoObjectKey,
  uploadFileStream,
} from "#app/utils/storage.server.ts";
import { vi } from "vitest";

describe("buildVideoObjectKey", () => {
  test("builds video/tracks/{service}/{trackId}.{ext}", () => {
    expect(buildVideoObjectKey("local", "t1", ".MP4")).toBe("video/tracks/local/t1.mp4");
  });

  test("requires all parts", () => {
    expect(() => buildVideoObjectKey("", "t1", "mp4")).toThrow();
    expect(() => buildVideoObjectKey("local", "", "mp4")).toThrow();
    expect(() => buildVideoObjectKey("local", "t1", "")).toThrow();
  });

  test("isVideoObjectKey matches video keys only", () => {
    expect(isVideoObjectKey("video/tracks/local/t1.mp4")).toBe(true);
    expect(isVideoObjectKey("audio/tracks/local/t1.mp3")).toBe(false);
    expect(isVideoObjectKey("video/tracks/../x.mp4")).toBe(false);
    expect(isVideoObjectKey("video/tracks/local/t1")).toBe(false);
  });
});

describe("uploadFileStream", () => {
  test("rejects a stream above maxBytes", async () => {
    const stream = Readable.from([Buffer.alloc(600), Buffer.alloc(600)]);
    await expect(
      uploadFileStream({
        body: stream,
        key: "video/tracks/local/too-big.mp4",
        contentType: "video/mp4",
        maxBytes: 1000,
      }),
    ).rejects.toBeInstanceOf(VideoUploadTooLargeError);
  });

  test("returns key and byte count for a stream within the cap", async () => {
    const stream = Readable.from([Buffer.alloc(100)]);
    const result = await uploadFileStream({
      body: stream,
      key: "video/tracks/local/ok.mp4",
      contentType: "video/mp4",
      maxBytes: 1000,
    });
    expect(result).toEqual({ key: "video/tracks/local/ok.mp4", size: 100 });
  });
});

describe("deleteUnreferencedVideoObjectKeys", () => {
  test("deletes only keys with no TrackVideoFile row", async () => {
    const service = await prisma.service.create({
      data: { name: `vid-svc-${Date.now()}`, displayName: "x", baseUrl: "https://x.test" },
    });
    const track = await prisma.track.create({
      data: {
        title: "T",
        externalId: `vid-${Date.now()}`,
        service: { connect: { id: service.id } },
        artist: { create: { name: `A-${Date.now()}`, normalizedName: `a-${Date.now()}` } },
      },
    });
    await prisma.trackVideoFile.create({
      data: { trackId: track.id, serviceId: service.id, objectKey: "video/tracks/x/kept.mp4" },
    });
    const deleteFile = vi.fn().mockResolvedValue(undefined);
    await deleteUnreferencedVideoObjectKeys(
      ["video/tracks/x/kept.mp4", "video/tracks/x/orphan.mp4", "video/tracks/x/orphan.mp4"],
      deleteFile,
    );
    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledWith("video/tracks/x/orphan.mp4");
  });
});
