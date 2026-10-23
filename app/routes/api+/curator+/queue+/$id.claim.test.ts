import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { requireCuratorRole } from "#app/utils/permissions.server.ts";
import { action } from "./$id.claim.ts";

vi.mock("#app/utils/permissions.server.ts", () => ({
  requireCuratorRole: vi.fn(),
}));

function postRequest(id: string) {
  return {
    request: new Request(`http://localhost/api/curator/queue/${id}/claim`, { method: "POST" }),
    params: { id },
    context: {},
  } as never;
}

describe("POST /api/curator/queue/:id/claim", () => {
  beforeEach(async () => {
    await prisma.reviewQueueItem.deleteMany();
  });

  test("claims an open item atomically", async () => {
    const curator = await prisma.user.create({ data: createUser() });
    vi.mocked(requireCuratorRole).mockResolvedValue(curator.id);

    const item = await prisma.reviewQueueItem.create({
      data: {
        entityType: "track",
        entityId: "track-1",
        source: "user_report",
        issueType: "wrong_metadata",
      },
    });

    const response = await action(postRequest(item.id));

    expect(response.data).toEqual({ success: true });

    const claimed = await prisma.reviewQueueItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(claimed.status).toBe("claimed");
    expect(claimed.claimedBy).toBe(curator.id);
  });

  test("rejects a second claim of an already-claimed item", async () => {
    const curator = await prisma.user.create({ data: createUser() });
    vi.mocked(requireCuratorRole).mockResolvedValue(curator.id);

    const item = await prisma.reviewQueueItem.create({
      data: {
        entityType: "track",
        entityId: "track-1",
        source: "system",
        issueType: "duplicate",
        status: "claimed",
      },
    });

    const response = await action(postRequest(item.id));

    expect(response.init?.status).toBe(400);
    expect(response.data).toEqual({
      success: false,
      error: "Queue item is not available for claiming",
    });
  });

  test("returns 404 for a missing item", async () => {
    vi.mocked(requireCuratorRole).mockResolvedValue("curator-1");

    const response = await action(postRequest("missing"));

    expect(response.init?.status).toBe(404);
  });
});
