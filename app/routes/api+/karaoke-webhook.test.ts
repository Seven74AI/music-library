import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { createTrack } from "#tests/db-utils.ts";
import { action } from "./karaoke-webhook.tsx";

const SECRET = "test-secret";

beforeEach(() => {
  process.env.KARAOKE_WEBHOOK_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.KARAOKE_WEBHOOK_SECRET;
});

async function makeJob() {
  const track = await createTrack("T");
  const version = await prisma.trackKaraokeVersion.create({
    data: {
      trackId: track.id,
      language: "en",
      source: "whisper",
      lyricsText: "",
      lines: "[]",
    },
  });
  const job = await prisma.karaokeGenerationJob.create({
    data: {
      versionId: version.id,
      status: "dispatched",
      providerJobId: `p-${version.id}`,
    },
  });
  return { version, job };
}

async function call(body: unknown, secret: string | null = SECRET) {
  const res = await action({
    request: new Request("http://localhost/api/karaoke-webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(secret === null ? {} : { "x-karaoke-webhook-secret": secret }),
      },
      body: JSON.stringify(body),
    }),
    params: {},
    context: {},
  } as never);
  const r = res as { data?: any; init?: { status?: number } } | Response;
  if (r instanceof Response)
    return { status: r.status, body: (await r.json()) as any };
  return { status: r.init?.status ?? 200, body: r.data as any };
}

const LINES = [
  [
    { word: "hello", start: 1, end: 1.5 },
    { word: "world", start: 1.5, end: 2 },
  ],
];

describe("karaoke webhook", () => {
  test("401 without or with wrong secret", async () => {
    const { version, job } = await makeJob();
    const body = {
      providerJobId: job.providerJobId,
      versionId: version.id,
      lines: LINES,
    };
    expect((await call(body, null)).status).toBe(401);
    expect((await call(body, "nope")).status).toBe(401);
  });

  test("401 when no secret is configured", async () => {
    delete process.env.KARAOKE_WEBHOOK_SECRET;
    expect((await call({}, "")).status).toBe(401);
  });

  test("completes the job, writes lines and text, leaves version draft", async () => {
    const { version, job } = await makeJob();
    const r = await call({
      providerJobId: job.providerJobId,
      versionId: version.id,
      lines: LINES,
      text: "hello world",
    });
    expect(r.status).toBe(200);
    const v = await prisma.trackKaraokeVersion.findUnique({
      where: { id: version.id },
    });
    expect(JSON.parse(v!.lines)).toEqual(LINES);
    expect(v).toMatchObject({ lyricsText: "hello world", status: "draft" });
    expect(
      (await prisma.karaokeGenerationJob.findUnique({ where: { id: job.id } }))
        ?.status,
    ).toBe("completed");
  });

  test("duplicate webhook is a no-op", async () => {
    const { version, job } = await makeJob();
    const body = {
      providerJobId: job.providerJobId,
      versionId: version.id,
      lines: LINES,
    };
    expect((await call(body)).body.applied).toBe(true);
    await prisma.trackKaraokeVersion.update({
      where: { id: version.id },
      data: { lines: "[]" },
    });
    const second = await call(body);
    expect(second.status).toBe(200);
    expect(second.body.applied).toBe(false);
    expect(
      (
        await prisma.trackKaraokeVersion.findUnique({
          where: { id: version.id },
        })
      )?.lines,
    ).toBe("[]");
  });

  test("404 on unknown job", async () => {
    const { version } = await makeJob();
    expect(
      (
        await call({
          providerJobId: "missing",
          versionId: version.id,
          lines: LINES,
        })
      ).status,
    ).toBe(404);
  });

  test("400 on malformed lines (non-monotonic / not line-grouped)", async () => {
    const { version, job } = await makeJob();
    const base = { providerJobId: job.providerJobId, versionId: version.id };
    const bad = [
      [
        { word: "a", start: 5, end: 6 },
        { word: "b", start: 1, end: 2 },
      ],
    ];
    expect((await call({ ...base, lines: bad })).status).toBe(400);
    expect(
      (await call({ ...base, lines: [{ word: "a", start: 0, end: 1 }] }))
        .status,
    ).toBe(400);
    expect(
      (await prisma.karaokeGenerationJob.findUnique({ where: { id: job.id } }))
        ?.status,
    ).toBe("dispatched");
  });
});
