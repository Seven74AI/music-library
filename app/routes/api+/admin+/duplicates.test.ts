import { afterEach, describe, expect, test } from "vitest";
import { compressChromaprint } from "#tests/chromaprint-test-utils";
import { prisma } from "#app/utils/db.server.ts";
import {
  createSessionCookie,
  ensureLocalService,
  readThrownStatus,
  unwrap,
} from "#tests/api-admin-test-utils.ts";
import { action as pageAction } from "#app/routes/music+/admin+/duplicates.tsx";
import { action, loader } from "./duplicates.tsx";

const EXACT_HASH = "exact-hash-dup-test";
const FILE_SIZE = 4096;

async function createTrackWithAudio(opts: {
  title: string;
  contentHash: string;
  audioFingerprint?: string | null;
  fileSize?: number;
}) {
  const service = await ensureLocalService();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const artist = await prisma.artist.create({
    data: {
      name: `${opts.title} ${suffix}`,
      normalizedName: `dup-test-${suffix}`,
    },
  });
  const track = await prisma.track.create({
    data: {
      title: opts.title,
      externalId: `dup-test-${suffix}`,
      artistId: artist.id,
      serviceId: service.id,
      audioFiles: {
        create: {
          objectKey: `audio/test-dup/${suffix}.mp3`,
          contentHash: opts.contentHash,
          audioFingerprint: opts.audioFingerprint ?? null,
          format: "mp3",
          mimeType: "audio/mpeg",
          fileName: `${opts.title}.mp3`,
          fileSize: opts.fileSize ?? FILE_SIZE,
          serviceId: service.id,
        },
      },
    },
    include: { audioFiles: true },
  });
  return track;
}

interface Dashboard {
  stats: { storageSaved: number; duplicateGroups: number; totalDuplicates: number };
  groups: Array<{
    id: string;
    type: "exact" | "similar";
    confidence?: number;
    tracks: Array<{ title: string }>;
  }>;
  filter: string;
}

function loadDashboard(cookie: string, filter?: string) {
  const search = filter ? `?filter=${filter}` : "";
  const request = new Request(`http://localhost/api/admin/duplicates${search}`, {
    headers: { cookie },
  });
  return loader({
    request,
    params: {},
    context: {} as never,
    url: new URL(request.url),
    pattern: "/api/admin/duplicates",
  });
}

function markRequest(cookie: string, groupKey: string, groupType: string) {
  const body = new URLSearchParams({
    intent: "mark-intentional",
    groupKey,
    groupType,
  });
  return new Request("http://localhost/api/admin/duplicates", {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
}

describe("admin duplicate dashboard", () => {
  afterEach(async () => {
    await prisma.track.deleteMany({ where: { externalId: { startsWith: "dup-test-" } } });
    await prisma.artist.deleteMany({ where: { normalizedName: { startsWith: "dup-test-" } } });
    await prisma.duplicateIntentionalGroup.deleteMany();
  });

  test("similar, exact, all, and intentional filters return the right groups", async () => {
    const { cookie } = await createSessionCookie("admin");

    // Valid compressed Chromaprints. Similar A/B differ by one bit (~0.998),
    // Different A/B differ by 16 bits per subfingerprint (~0.5).
    const similarBase = Array.from({ length: 20 }, (_, i) => 0x11110000 + i);
    const similarNear = [...similarBase];
    similarNear[5] = (similarNear[5]! ^ 1) >>> 0;
    const differentA = Array.from({ length: 20 }, (_, i) => 0x22220000 + i);
    const differentB = Array.from({ length: 20 }, (_, i) => 0xeeee0000 + i);

    await createTrackWithAudio({
      title: "Exact A",
      contentHash: EXACT_HASH,
      audioFingerprint: "exact-fp-should-not-matter",
    });
    await createTrackWithAudio({
      title: "Exact B",
      contentHash: EXACT_HASH,
      audioFingerprint: "exact-fp-should-not-matter",
    });
    await createTrackWithAudio({
      title: "Similar A",
      contentHash: "similar-hash-a",
      audioFingerprint: compressChromaprint(similarBase),
    });
    await createTrackWithAudio({
      title: "Similar B",
      contentHash: "similar-hash-b",
      audioFingerprint: compressChromaprint(similarNear),
    });
    await createTrackWithAudio({
      title: "Different A",
      contentHash: "different-hash-a",
      audioFingerprint: compressChromaprint(differentA),
    });
    await createTrackWithAudio({
      title: "Different B",
      contentHash: "different-hash-b",
      audioFingerprint: compressChromaprint(differentB),
    });

    const exact = unwrap<Dashboard>(await loadDashboard(cookie, "exact"));
    expect(exact.filter).toBe("exact");
    expect(exact.groups.some((group) => group.id === EXACT_HASH && group.type === "exact")).toBe(
      true,
    );
    expect(exact.groups.some((group) => group.type === "similar")).toBe(false);

    const similar = unwrap<Dashboard>(await loadDashboard(cookie, "similar"));
    expect(similar.filter).toBe("similar");
    expect(similar.groups.every((group) => group.type === "similar")).toBe(true);
    const similarGroup = similar.groups.find((group) => group.id.startsWith("similar:"));
    expect(similarGroup).toBeTruthy();
    expect(similarGroup?.confidence).toBeGreaterThanOrEqual(0.9);
    expect(similarGroup?.tracks.map((track) => track.title).sort()).toEqual([
      "Similar A",
      "Similar B",
    ]);
    expect(similar.groups.some((group) => group.id === EXACT_HASH)).toBe(false);
    expect(similar.stats.storageSaved).toBe(0);

    const all = unwrap<Dashboard>(await loadDashboard(cookie, "all"));
    expect(all.groups.some((group) => group.id === EXACT_HASH)).toBe(true);
    expect(all.groups.some((group) => group.type === "similar")).toBe(true);

    const intentional = unwrap<Dashboard>(await loadDashboard(cookie, "intentional"));
    expect(intentional.groups).toEqual([]);
    expect(intentional.stats.duplicateGroups).toBe(0);
  });

  test("marking a group intentional hides it from the default list and updates stats", async () => {
    const { cookie } = await createSessionCookie("admin");
    const first = await createTrackWithAudio({
      title: "Keep A",
      contentHash: EXACT_HASH,
      fileSize: FILE_SIZE,
    });
    const second = await createTrackWithAudio({
      title: "Keep B",
      contentHash: EXACT_HASH,
      fileSize: FILE_SIZE,
    });

    const before = unwrap<Dashboard>(await loadDashboard(cookie, "all"));
    expect(before.groups.some((group) => group.id === EXACT_HASH)).toBe(true);

    const marked = unwrap<Dashboard>(
      await action({
        request: markRequest(cookie, EXACT_HASH, "exact"),
        params: {},
        context: {} as never,
        url: new URL("http://localhost/api/admin/duplicates"),
        pattern: "/api/admin/duplicates",
      } as never),
    );
    expect(marked.stats.duplicateGroups).toBe(before.stats.duplicateGroups - 1);
    expect(marked.stats.totalDuplicates).toBe(before.stats.totalDuplicates - 1);
    expect(marked.stats.storageSaved).toBe(before.stats.storageSaved - FILE_SIZE);
    expect(marked.groups.some((group) => group.id === EXACT_HASH)).toBe(false);

    const after = unwrap<Dashboard>(await loadDashboard(cookie, "all"));
    expect(after.groups.some((group) => group.id === EXACT_HASH)).toBe(false);
    expect(after.stats.storageSaved).toBe(before.stats.storageSaved - FILE_SIZE);

    const intentional = unwrap<Dashboard>(await loadDashboard(cookie, "intentional"));
    expect(
      intentional.groups.some((group) => group.id === EXACT_HASH && group.type === "exact"),
    ).toBe(true);

    const exactFilter = unwrap<Dashboard>(await loadDashboard(cookie, "exact"));
    expect(exactFilter.groups.some((group) => group.id === EXACT_HASH)).toBe(false);

    expect(await prisma.track.count({ where: { id: { in: [first.id, second.id] } } })).toBe(2);
  });

  test("the page action round-trips a similar group into the intentional filter", async () => {
    const { cookie } = await createSessionCookie("admin");
    await createTrackWithAudio({
      title: "Near A",
      contentHash: "near-a",
      audioFingerprint: "abcdefghij",
    });
    await createTrackWithAudio({
      title: "Near B",
      contentHash: "near-b",
      audioFingerprint: "abcdefghij",
    });

    const similar = unwrap<Dashboard>(await loadDashboard(cookie, "similar"));
    const group = similar.groups.find((entry) => entry.type === "similar");
    expect(group).toBeTruthy();

    await pageAction({
      request: markRequest(cookie, group!.id, "similar"),
      params: {},
      context: {} as never,
      url: new URL("http://localhost/music/admin/duplicates?filter=similar"),
      pattern: "/music/admin/duplicates",
    } as never);

    const hidden = unwrap<Dashboard>(await loadDashboard(cookie, "similar"));
    expect(hidden.groups.some((entry) => entry.id === group!.id)).toBe(false);
    expect(hidden.stats.duplicateGroups).toBe(similar.stats.duplicateGroups - 1);

    const shown = unwrap<Dashboard>(await loadDashboard(cookie, "intentional"));
    expect(shown.groups.some((entry) => entry.id === group!.id && entry.type === "similar")).toBe(
      true,
    );
  });

  test("non-admins cannot mark a group intentional", async () => {
    const { cookie } = await createSessionCookie();
    let status: number | undefined;
    try {
      await action({
        request: markRequest(cookie, EXACT_HASH, "exact"),
        params: {},
        context: {} as never,
        url: new URL("http://localhost/api/admin/duplicates"),
        pattern: "/api/admin/duplicates",
      } as never);
    } catch (error) {
      status = await readThrownStatus(error);
    }
    expect(status).toBe(403);
  });
});
