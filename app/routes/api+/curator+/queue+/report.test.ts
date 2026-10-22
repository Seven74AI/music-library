import { beforeEach, describe, expect, test, vi } from "vitest";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { makeRateLimiter } from "#app/utils/rate-limit.server.ts";
import { action, clientAction, REPORT_RATE_LIMIT_PER_MINUTE } from "./report.ts";

vi.mock("#app/utils/auth.server.ts", () => ({
  requireUserId: vi.fn(),
}));

vi.mock("#app/utils/db.server.ts", () => ({
  prisma: {
    track: { findUnique: vi.fn() },
    reviewQueueItem: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

function reportRequest(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  formData.set("trackId", "track-1");
  formData.set("issueType", "wrong_metadata");
  formData.set("description", "Wrong artist name");
  for (const [key, value] of Object.entries(overrides)) formData.set(key, value);
  return new Request("http://localhost/api/curator/queue/report", {
    method: "POST",
    body: formData,
  });
}

/** react-router data() wraps the payload in `{ data, init }`. */
async function runAction(request: Request): Promise<{ data: unknown; status: number }> {
  const result = (await action({ request, params: {}, context: {} } as never)) as {
    data: unknown;
    init?: { status?: number };
  };
  return { data: result.data, status: result.init?.status ?? 200 };
}

describe("clientAction for POST /api/curator/queue/report", () => {
  test("forwards the fetcher submission to the server action", async () => {
    const payload = { success: true };
    const serverAction = vi.fn().mockResolvedValue(payload);

    const result = await clientAction({
      request: reportRequest(),
      params: {},
      serverAction,
    } as never);

    expect(serverAction).toHaveBeenCalledOnce();
    expect(result).toEqual(payload);
  });
});

describe("action for POST /api/curator/queue/report", () => {
  beforeEach(() => {
    makeRateLimiter("track-report", REPORT_RATE_LIMIT_PER_MINUTE).reset();
    vi.mocked(requireUserId).mockResolvedValue("user-1");
    vi.mocked(prisma.track.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.reviewQueueItem.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.reviewQueueItem.create).mockResolvedValue({ id: "item-1" } as never);
    vi.mocked(prisma.reviewQueueItem.update).mockResolvedValue({ id: "item-1" } as never);
  });

  test("returns 404 for a nonexistent track", async () => {
    vi.mocked(prisma.track.findUnique).mockResolvedValue(null);

    const result = await runAction(reportRequest());

    expect(result).toEqual({
      data: { success: false, error: "Track not found" },
      status: 404,
    });
    expect(prisma.reviewQueueItem.create).not.toHaveBeenCalled();
  });

  test("creates a queue item when no open item exists", async () => {
    vi.mocked(prisma.track.findUnique).mockResolvedValue({
      id: "track-1",
      title: "Track",
    } as never);

    const result = await runAction(reportRequest());

    expect(result).toEqual({ data: { success: true }, status: 200 });
    expect(prisma.reviewQueueItem.create).toHaveBeenCalledOnce();
    expect(prisma.reviewQueueItem.update).not.toHaveBeenCalled();
  });

  test("increments reportCount instead of creating a duplicate open item", async () => {
    vi.mocked(prisma.track.findUnique).mockResolvedValue({
      id: "track-1",
      title: "Track",
    } as never);
    vi.mocked(prisma.reviewQueueItem.findFirst).mockResolvedValue({ id: "item-1" } as never);

    const result = await runAction(reportRequest());

    expect(result).toEqual({ data: { success: true }, status: 200 });
    expect(prisma.reviewQueueItem.update).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { reportCount: { increment: 1 } },
    });
    expect(prisma.reviewQueueItem.create).not.toHaveBeenCalled();
  });

  test("rate limits report submissions per user", async () => {
    vi.mocked(prisma.track.findUnique).mockResolvedValue({
      id: "track-1",
      title: "Track",
    } as never);

    for (let i = 0; i < REPORT_RATE_LIMIT_PER_MINUTE; i++) {
      const result = await runAction(reportRequest());
      expect(result.status).toBe(200);
    }

    const limited = await runAction(reportRequest());
    expect(limited.status).toBe(429);
    expect(limited.data).toMatchObject({ success: false });
  });
});
