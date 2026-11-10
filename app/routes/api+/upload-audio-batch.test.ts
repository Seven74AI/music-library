import { readFileSync } from "node:fs";
import AdmZip from "adm-zip";
import { parseString } from "set-cookie-parser";
import { beforeEach, expect, test, vi } from "vitest";
import { LOCAL_SERVICE } from "#app/constants/services.ts";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { consoleError, consoleWarn } from "#tests/setup/setup-test-env.ts";
import { UPLOAD_BATCH_FILE_CLIENT_ERROR_MESSAGE } from "#app/utils/error-handlers.server";
import { action } from "./upload-audio-batch.tsx";
import { getUploadProgress } from "#app/features/upload-progress/progress-store.server.ts";

const tinyMp3 = readFileSync(new URL("../../../tests/fixtures/tiny-tone.mp3", import.meta.url));

const {
  mockPrepareCoverImageUpload,
  mockCreateCoverImageInTx,
  mockDeleteFile,
  mockCreateTrackAudioFile,
} = vi.hoisted(() => ({
  mockPrepareCoverImageUpload: vi.fn(),
  mockCreateCoverImageInTx: vi.fn(),
  mockDeleteFile: vi.fn().mockResolvedValue(undefined),
  mockCreateTrackAudioFile: vi.fn(),
}));

vi.mock("#app/utils/storage.server.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("#app/utils/storage.server.ts")>();
  return { ...original, deleteFile: mockDeleteFile };
});

vi.mock("#app/utils/cover-management.server", async (importOriginal) => {
  const original = await importOriginal<typeof import("#app/utils/cover-management.server.ts")>();
  return {
    ...original,
    prepareCoverImageUpload: mockPrepareCoverImageUpload,
    createCoverImageInTx: mockCreateCoverImageInTx,
  };
});

vi.mock(
  "#app/features/track-audio-ingest/persist-track-audio.server.ts",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("#app/features/track-audio-ingest/persist-track-audio.server.ts")
      >();
    return {
      ...original,
      createTrackAudioFile: mockCreateTrackAudioFile,
    };
  },
);

beforeEach(async () => {
  mockPrepareCoverImageUpload.mockReset();
  mockCreateCoverImageInTx.mockReset();
  mockDeleteFile.mockClear();
  mockCreateTrackAudioFile.mockReset();
  const original = await vi.importActual<
    typeof import("#app/features/track-audio-ingest/persist-track-audio.server.ts")
  >("#app/features/track-audio-ingest/persist-track-audio.server.ts");
  mockCreateTrackAudioFile.mockImplementation(original.createTrackAudioFile);
});

async function createAdminCookie() {
  const user = await prisma.user.create({
    select: { id: true },
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
  const cookie = new URLSearchParams({
    [parsedCookie.name]: parsedCookie.value,
  }).toString();
  return { userId: user.id, cookie };
}

async function waitForUpload(uploadId: string) {
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    const progress = await getUploadProgress(uploadId);
    if (progress && progress.status !== "active") return progress;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Upload ${uploadId} did not finish`);
}

test("a valid file still uploads when another file in the batch is empty", async () => {
  // CI images do not ship fpcalc. A missing fingerprint is logged and ignored;
  // the test spy turns that log into a throw, which used to abort the upload.
  consoleError.mockImplementation((...args: unknown[]) => {
    const message = args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(" ");
    if (message.includes("Failed to generate audio fingerprint")) return;
    throw new Error(
      `Console error was called: ${message}. Call consoleError.mockImplementation(() => {}) if this is expected.`,
    );
  });

  await prisma.service.upsert({
    where: { name: LOCAL_SERVICE.NAME },
    update: {},
    create: {
      name: LOCAL_SERVICE.NAME,
      displayName: LOCAL_SERVICE.DISPLAY_NAME,
      baseUrl: LOCAL_SERVICE.BASE_URL,
    },
  });

  const { userId, cookie } = await createAdminCookie();
  const title = `QA mixed upload ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const artist = `QA Artist ${title}`;
  const uploadId = `upload-mixed-${Date.now()}`;

  try {
    const formData = new FormData();
    formData.append("uploadId", uploadId);
    formData.append("files", new File([tinyMp3], "good.mp3", { type: "audio/mpeg" }));
    formData.append("files", new File([], "empty.mp3", { type: "audio/mpeg" }));
    formData.append("metadata[0]", JSON.stringify({ title, artist }));
    formData.append("metadata[1]", JSON.stringify({ title: `${title} empty`, artist }));

    const response = await action({
      request: new Request("http://localhost/api/upload-audio-batch", {
        method: "POST",
        headers: { cookie },
        body: formData,
      }),
      params: {},
      context: {},
    } as never);

    expect(response.init?.status).toBe(202);
    expect(response.data).toMatchObject({ success: true, uploadId });

    const progress = await waitForUpload(uploadId);
    expect(progress.failedFiles?.map((file) => file.fileName)).toContain("empty.mp3");
    expect(progress.failedFiles?.find((file) => file.fileName === "empty.mp3")?.error).toMatch(
      /empty/i,
    );
    expect(progress.successfulTracks).toEqual([
      expect.objectContaining({ fileName: "good.mp3", title, artist }),
    ]);

    const stored = await prisma.track.findFirst({
      where: { title, artist: { name: artist } },
      select: { id: true },
    });
    expect(stored).not.toBeNull();
  } finally {
    const tracks = await prisma.track.findMany({
      where: { artist: { name: artist } },
      select: { id: true, artistId: true },
    });
    if (tracks.length > 0) {
      await prisma.track.deleteMany({ where: { id: { in: tracks.map((track) => track.id) } } });
      const artistIds = [...new Set(tracks.map((track) => track.artistId))];
      await prisma.artist.deleteMany({ where: { id: { in: artistIds } } });
    }
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  }
}, 20_000);

test("an over-cap audio ZIP returns 400 and does not upload a partial set", async () => {
  const { userId, cookie } = await createAdminCookie();
  const uploadId = `upload-over-cap-${Date.now()}`;
  const zip = new AdmZip();
  for (let index = 0; index < 101; index++) {
    zip.addFile(`track-${index}.mp3`, Buffer.alloc(1024, 1));
  }
  const zipBytes = new Uint8Array(zip.toBuffer());

  try {
    const formData = new FormData();
    formData.append("uploadId", uploadId);
    formData.append("zipFile", new File([zipBytes], "album.zip", { type: "application/zip" }));

    const response = await action({
      request: new Request("http://localhost/api/upload-audio-batch", {
        method: "POST",
        headers: { cookie },
        body: formData,
      }),
      params: {},
      context: {},
    } as never);

    expect(response.init?.status).toBe(400);
    expect(response.data).toMatchObject({
      success: false,
      error: expect.stringMatching(/more than 100 audio files/),
    });
    expect(await getUploadProgress(uploadId)).toBeUndefined();
  } finally {
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  }
});

function allowUploadConsoleErrors() {
  consoleError.mockImplementation((...args: unknown[]) => {
    const message = args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(" ");
    if (message.includes("Failed to generate audio fingerprint")) return;
    if (message.includes("Error extracting metadata from")) return;
    if (message.includes("Error uploading file")) return;
    throw new Error(
      `Console error was called: ${message}. Call consoleError.mockImplementation(() => {}) if this is expected.`,
    );
  });
  consoleWarn.mockImplementation((...args: unknown[]) => {
    const message = args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(" ");
    if (message.includes("Post-commit progress update failed")) return;
    if (message.includes("Unexpected error after DB commit")) return;
    if (message.includes("Duplicate audio detected")) return;
    if (message.includes("Duplicate:")) return;
    throw new Error(
      `Console warn was called: ${message}. Call consoleWarn.mockImplementation(() => {}) if this is expected.`,
    );
  });
}

async function seedLocalService() {
  await prisma.service.upsert({
    where: { name: LOCAL_SERVICE.NAME },
    update: {},
    create: {
      name: LOCAL_SERVICE.NAME,
      displayName: LOCAL_SERVICE.DISPLAY_NAME,
      baseUrl: LOCAL_SERVICE.BASE_URL,
    },
  });
}

async function cleanupUploadArtist(artist: string, userId: string) {
  const tracks = await prisma.track.findMany({
    where: { artist: { name: artist } },
    select: { id: true, artistId: true },
  });
  if (tracks.length > 0) {
    await prisma.track.deleteMany({ where: { id: { in: tracks.map((track) => track.id) } } });
    const artistIds = [...new Set(tracks.map((track) => track.artistId))];
    await prisma.artist.deleteMany({ where: { id: { in: artistIds } } });
  }
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
}

async function postBatch(cookie: string, uploadId: string, fileEntries: Array<[string, string]>) {
  const formData = new FormData();
  formData.append("uploadId", uploadId);
  fileEntries.forEach(([fileName, metadata], index) => {
    formData.append("files", new File([tinyMp3], fileName, { type: "audio/mpeg" }));
    formData.append(`metadata[${index}]`, metadata);
  });
  return action({
    request: new Request("http://localhost/api/upload-audio-batch", {
      method: "POST",
      headers: { cookie },
      body: formData,
    }),
    params: {},
    context: {},
  } as never);
}

test("invalid user metadata JSON fails only that file, not the batch", async () => {
  allowUploadConsoleErrors();
  await seedLocalService();
  const { userId, cookie } = await createAdminCookie();
  const title = `QA bad-json ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const artist = `QA Artist ${title}`;
  const uploadId = `upload-bad-json-${Date.now()}`;

  try {
    const response = await postBatch(cookie, uploadId, [
      ["good.mp3", JSON.stringify({ title, artist })],
      ["bad.mp3", "{not valid json"],
    ]);

    expect(response.init?.status).toBe(202);

    const progress = await waitForUpload(uploadId);
    expect(progress.failedFiles?.map((file) => file.fileName)).toContain("bad.mp3");
    expect(progress.failedFiles?.find((file) => file.fileName === "bad.mp3")?.error).toMatch(
      /Invalid user metadata JSON/,
    );
    expect(progress.successfulTracks).toEqual([
      expect.objectContaining({ fileName: "good.mp3", title, artist }),
    ]);
  } finally {
    await cleanupUploadArtist(artist, userId);
  }
}, 20_000);

test("fractional bpm in user metadata is rounded and upload succeeds", async () => {
  allowUploadConsoleErrors();
  await seedLocalService();
  const { userId, cookie } = await createAdminCookie();
  const title = `QA frac-bpm ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const artist = `QA Artist ${title}`;
  const uploadId = `upload-frac-bpm-${Date.now()}`;

  try {
    const response = await postBatch(cookie, uploadId, [
      ["good.mp3", JSON.stringify({ title, artist, bpm: 128.6 })],
    ]);

    expect(response.init?.status).toBe(202);

    const progress = await waitForUpload(uploadId);
    expect(progress.failedFiles).toEqual([]);
    expect(progress.successfulTracks).toEqual([
      expect.objectContaining({ fileName: "good.mp3", title, artist }),
    ]);

    const stored = await prisma.track.findFirst({
      where: { title, artist: { name: artist } },
      select: { bpm: true },
    });
    expect(stored?.bpm).toBe(129);
  } finally {
    await cleanupUploadArtist(artist, userId);
  }
}, 20_000);

test("invalid user metadata shape fails only that file, not the batch", async () => {
  allowUploadConsoleErrors();
  await seedLocalService();
  const { userId, cookie } = await createAdminCookie();
  const title = `QA bad-shape ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const artist = `QA Artist ${title}`;
  const uploadId = `upload-bad-shape-${Date.now()}`;

  try {
    const response = await postBatch(cookie, uploadId, [
      ["good.mp3", JSON.stringify({ title, artist })],
      ["bad.mp3", JSON.stringify({ title: 123, artist })],
    ]);

    expect(response.init?.status).toBe(202);

    const progress = await waitForUpload(uploadId);
    expect(progress.failedFiles?.map((file) => file.fileName)).toContain("bad.mp3");
    expect(progress.failedFiles?.find((file) => file.fileName === "bad.mp3")?.error).toMatch(
      /Invalid user metadata/,
    );
    expect(progress.successfulTracks).toEqual([
      expect.objectContaining({ fileName: "good.mp3", title, artist }),
    ]);
  } finally {
    await cleanupUploadArtist(artist, userId);
  }
}, 20_000);

test("batch upload succeeds without a cover when cover persistence fails and deletes the object", async () => {
  allowUploadConsoleErrors();
  consoleWarn.mockImplementation(() => {});
  await seedLocalService();

  const coverObjectKey = `images/covers/batch-abandon-${Date.now()}.jpg`;
  mockPrepareCoverImageUpload.mockResolvedValue({
    kind: "new",
    objectKey: coverObjectKey,
    contentHash: `hash-${Date.now()}`,
    width: 100,
    height: 100,
    format: "jpeg",
    fileSize: 1000,
  });
  mockCreateCoverImageInTx.mockRejectedValue(new Error("db write failed"));

  const { extractAudioMetadata: baseExtract } = await vi.importActual<
    typeof import("#app/utils/audio-metadata.server.ts")
  >("#app/utils/audio-metadata.server.ts");
  const metadataModule = await import("#app/utils/audio-metadata.server.ts");
  const extractSpy = vi.spyOn(metadataModule, "extractAudioMetadata");
  extractSpy.mockImplementation(async (buffer, fileName) => {
    const metadata = await baseExtract(buffer, fileName);
    return { ...metadata, coverImage: { data: Buffer.from("fake"), format: "jpeg" } };
  });

  const { userId, cookie } = await createAdminCookie();
  const title = `Batch cover abandon ${Date.now()}`;
  const artist = `QA Artist ${title}`;
  const uploadId = `upload-cover-abandon-${Date.now()}`;

  try {
    const response = await postBatch(cookie, uploadId, [
      ["good.mp3", JSON.stringify({ title, artist })],
    ]);
    expect(response.init?.status).toBe(202);

    const progress = await waitForUpload(uploadId);
    expect(progress.successfulTracks).toEqual([
      expect.objectContaining({ fileName: "good.mp3", title, artist }),
    ]);
    expect(mockDeleteFile).toHaveBeenCalledWith(coverObjectKey);

    const stored = await prisma.track.findFirst({
      where: { title },
      select: { coverImageId: true },
    });
    expect(stored?.coverImageId).toBeNull();
  } finally {
    extractSpy.mockRestore();
    await cleanupUploadArtist(artist, userId);
  }
}, 20_000);

test("a rolled-back DB transaction leaves no phantom success and records a failure", async () => {
  allowUploadConsoleErrors();
  await seedLocalService();
  mockCreateTrackAudioFile.mockRejectedValueOnce(new Error("db txn failed"));

  const { userId, cookie } = await createAdminCookie();
  const title = `QA txn-rollback ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const artist = `QA Artist ${title}`;
  const uploadId = `upload-txn-rollback-${Date.now()}`;

  try {
    const response = await postBatch(cookie, uploadId, [
      ["good.mp3", JSON.stringify({ title, artist })],
    ]);
    expect(response.init?.status).toBe(202);

    const progress = await waitForUpload(uploadId);
    expect(progress.successfulTracks).toEqual([]);
    expect(progress.failedFiles?.map((file) => file.fileName)).toContain("good.mp3");
    expect(progress.failedFiles?.find((file) => file.fileName === "good.mp3")?.error).toBe(
      UPLOAD_BATCH_FILE_CLIENT_ERROR_MESSAGE,
    );
    expect(progress.failedFiles?.find((file) => file.fileName === "good.mp3")?.error).not.toMatch(
      /prisma|db txn/i,
    );
    expect(await prisma.track.count({ where: { title, artist: { name: artist } } })).toBe(0);
  } finally {
    await cleanupUploadArtist(artist, userId);
  }
}, 20_000);

test("a post-commit progress write failure keeps the committed track out of failedFiles", async () => {
  allowUploadConsoleErrors();
  await seedLocalService();

  const progressStore = await import("#app/features/upload-progress/progress-store.server.ts");
  const realUpdateFileProgress = progressStore.updateFileProgress;
  let completedProgressAttempts = 0;
  const updateSpy = vi
    .spyOn(progressStore, "updateFileProgress")
    .mockImplementation(async (uploadId, fileId, progress, status, ...rest) => {
      if (status === "completed" && progress === 100) {
        completedProgressAttempts += 1;
        if (completedProgressAttempts === 1) {
          throw new Error("progress backend unavailable");
        }
      }
      return realUpdateFileProgress(uploadId, fileId, progress, status, ...rest);
    });

  const { userId, cookie } = await createAdminCookie();
  const title = `QA post-commit-progress ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const artist = `QA Artist ${title}`;
  const uploadId = `upload-post-commit-${Date.now()}`;

  try {
    const response = await postBatch(cookie, uploadId, [
      ["good.mp3", JSON.stringify({ title, artist })],
    ]);
    expect(response.init?.status).toBe(202);

    const progress = await waitForUpload(uploadId);
    expect(progress.failedFiles).toEqual([]);
    expect(progress.successfulTracks).toEqual([
      expect.objectContaining({ fileName: "good.mp3", title, artist }),
    ]);
    expect(await prisma.track.count({ where: { title, artist: { name: artist } } })).toBe(1);
  } finally {
    updateSpy.mockRestore();
    await cleanupUploadArtist(artist, userId);
  }
}, 20_000);

test("retry after a rolled-back upload inserts only one library row", async () => {
  allowUploadConsoleErrors();
  await seedLocalService();
  mockCreateTrackAudioFile.mockRejectedValueOnce(new Error("db txn failed"));

  const { userId, cookie } = await createAdminCookie();
  const title = `QA retry-once ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const artist = `QA Artist ${title}`;
  const firstUploadId = `upload-retry-once-a-${Date.now()}`;
  const retryUploadId = `upload-retry-once-b-${Date.now()}`;

  try {
    const first = await postBatch(cookie, firstUploadId, [
      ["good.mp3", JSON.stringify({ title, artist })],
    ]);
    expect(first.init?.status).toBe(202);
    await waitForUpload(firstUploadId);

    const second = await postBatch(cookie, retryUploadId, [
      ["good.mp3", JSON.stringify({ title, artist })],
    ]);
    expect(second.init?.status).toBe(202);
    await waitForUpload(retryUploadId);

    expect(await prisma.track.count({ where: { title, artist: { name: artist } } })).toBe(1);
  } finally {
    await cleanupUploadArtist(artist, userId);
  }
}, 40_000);
