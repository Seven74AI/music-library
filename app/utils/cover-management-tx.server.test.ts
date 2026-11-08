import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUploadFile, mockDeleteFile, mockPrisma, sharpDefault } = vi.hoisted(() => ({
  mockUploadFile: vi.fn(),
  mockDeleteFile: vi.fn(),
  mockPrisma: {
    coverImage: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    album: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  sharpDefault: vi.fn((_input: unknown) => ({
    resize: () => ({
      jpeg: () => ({ toBuffer: async () => Buffer.from("processed-image") }),
    }),
    metadata: async () => ({ width: 800, height: 600 }),
  })),
}));

vi.mock("#app/utils/storage.server", () => ({
  uploadFile: mockUploadFile,
  deleteFile: mockDeleteFile,
}));

vi.mock("#app/utils/db.server", () => ({
  prisma: mockPrisma,
}));

vi.mock("sharp", () => ({
  default: sharpDefault,
}));

import {
  CoverImageUploadError,
  cleanupFailedCoverUpload,
  prepareCoverImageUpload,
  createCoverImageInTx,
} from "./cover-management.server";

describe("cover image upload split (sharp/uploadFile outside the transaction)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUploadFile.mockResolvedValue("images/covers/test.jpg");
    mockDeleteFile.mockResolvedValue(undefined);
    mockPrisma.coverImage.findUnique.mockResolvedValue(null);
    mockPrisma.album.findUnique.mockResolvedValue(null);
    mockPrisma.coverImage.create.mockResolvedValue({
      id: "cover-1",
      objectKey: "images/covers/test.jpg",
    });
  });

  it("prepareCoverImageUpload uploads outside a transaction (no prisma write)", async () => {
    const prepared = await prepareCoverImageUpload({
      imageBuffer: Buffer.from("raw-image"),
      trackId: "track-1",
    });

    expect(prepared.kind).toBe("new");
    expect(mockUploadFile).toHaveBeenCalledTimes(1);
    // The slow step must not touch the database — no CoverImage row is written.
    expect(mockPrisma.coverImage.create).not.toHaveBeenCalled();
  });

  it("createCoverImageInTx refuses to persist a cover without a content hash", async () => {
    const tx = {
      coverImage: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      album: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    };

    await expect(
      createCoverImageInTx(
        tx as never,
        {
          kind: "new",
          objectKey: "images/covers/orphan.jpg",
          contentHash: "",
          width: 0,
          height: 0,
          format: "jpeg",
          fileSize: 0,
        },
        null,
      ),
    ).rejects.toThrow(/content hash/);

    expect(tx.coverImage.create).not.toHaveBeenCalled();
  });

  it("cleanupFailedCoverUpload deletes the uploaded object key", async () => {
    await cleanupFailedCoverUpload(
      new CoverImageUploadError("upload failed", "images/covers/orphan.jpg"),
    );

    expect(mockDeleteFile).toHaveBeenCalledWith("images/covers/orphan.jpg");
  });

  it("createCoverImageInTx writes the row via the tx client and never uploads", async () => {
    const tx = {
      coverImage: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "cover-1", objectKey: "images/covers/test.jpg" }),
      },
      album: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    };

    const result = await createCoverImageInTx(
      tx as never,
      {
        kind: "new",
        objectKey: "images/covers/test.jpg",
        contentHash: "hash-1",
        width: 800,
        height: 600,
        format: "jpeg",
        fileSize: 1234,
      },
      null,
    );

    expect(tx.coverImage.create).toHaveBeenCalledTimes(1);
    expect(mockUploadFile).not.toHaveBeenCalled();
    expect(result).toEqual({ id: "cover-1", objectKey: "images/covers/test.jpg" });
  });

  it("prepareCoverImageUpload reuses an existing cover by content hash (no upload)", async () => {
    mockPrisma.coverImage.findUnique.mockResolvedValue({
      id: "existing-cover",
      objectKey: "images/covers/existing.jpg",
    });

    const prepared = await prepareCoverImageUpload({
      imageBuffer: Buffer.from("raw-image"),
    });

    expect(prepared.kind).toBe("existing");
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it("prepareCoverImageUpload reuses the album's existing cover (no upload)", async () => {
    mockPrisma.album.findUnique.mockResolvedValue({
      id: "album-1",
      coverImage: { id: "album-cover", objectKey: "images/covers/album.jpg" },
    });

    const prepared = await prepareCoverImageUpload({
      imageBuffer: Buffer.from("raw-image"),
      albumId: "album-1",
    });

    expect(prepared.kind).toBe("album-cover");
    expect(mockUploadFile).not.toHaveBeenCalled();
  });
});
