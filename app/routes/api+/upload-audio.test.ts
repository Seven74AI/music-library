import { readFileSync } from "node:fs";
import { parseString } from "set-cookie-parser";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { LOCAL_SERVICE } from "#app/constants/services.ts";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { consoleError, consoleWarn } from "#tests/setup/setup-test-env.ts";
import { action } from "./upload-audio.tsx";

const tinyMp3 = readFileSync(new URL("../../../tests/fixtures/tiny-tone.mp3", import.meta.url));

const { mockBackfillTrackMetadata } = vi.hoisted(() => ({
  mockBackfillTrackMetadata: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("#app/features/track-audio-ingest/backfill-track-metadata.server.ts", () => ({
  backfillTrackMetadata: (...args: unknown[]) => mockBackfillTrackMetadata(...args),
}));

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

describe("upload-audio action", () => {
  beforeEach(() => {
    mockBackfillTrackMetadata.mockReset();
    mockBackfillTrackMetadata.mockResolvedValue(undefined);
    consoleError.mockImplementation(() => {});
    consoleWarn.mockImplementation(() => {});
  });

  test("rejects an empty audio file with 400", async () => {
    const { cookie } = await createAdminCookie();
    const formData = new FormData();
    formData.append("audioFile", new File([], "empty.mp3", { type: "audio/mpeg" }));
    formData.append("title", "Empty");
    formData.append("artist", "Nobody");

    const response = await action({
      request: new Request("http://localhost/api/upload-audio", {
        method: "POST",
        headers: { cookie },
        body: formData,
      }),
      params: {},
      context: {},
    } as never);

    expect(response.init?.status).toBe(400);
    expect(response.data).toMatchObject({ success: false, error: /empty/i });
  });

  test("returns success when metadata backfill fails after the track commit", async () => {
    mockBackfillTrackMetadata.mockRejectedValue(new Error("canonical merge failed"));

    consoleError.mockImplementation((...args: unknown[]) => {
      const message = args
        .map((arg) => (arg instanceof Error ? arg.message : String(arg)))
        .join(" ");
      if (message.includes("Failed to generate audio fingerprint")) return;
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

    const title = `Backfill ok ${Date.now()}`;
    const artist = `Backfill Artist ${title}`;
    const { cookie } = await createAdminCookie();

    const formData = new FormData();
    formData.append("audioFile", new File([tinyMp3], "good.mp3", { type: "audio/mpeg" }));
    formData.append("title", title);
    formData.append("artist", artist);

    const response = await action({
      request: new Request("http://localhost/api/upload-audio", {
        method: "POST",
        headers: { cookie },
        body: formData,
      }),
      params: {},
      context: {},
    } as never);

    expect(response.init?.status).toBe(201);
    expect(response.data).toMatchObject({
      success: true,
      track: { title, artist },
    });

    const stored = await prisma.track.findFirst({
      where: { title, artist: { name: artist } },
      select: { id: true },
    });
    expect(stored).not.toBeNull();
    expect(mockBackfillTrackMetadata).toHaveBeenCalled();
  });
});
