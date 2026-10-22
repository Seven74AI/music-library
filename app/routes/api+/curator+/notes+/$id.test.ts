import { describe, expect, test, vi, beforeEach } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { requireCuratorOrAdmin } from "#app/utils/curator.server.ts";
import { parseMentions } from "#app/utils/mention-parser.server.ts";
import { action, clientAction } from "./$id.ts";

vi.mock("#app/utils/curator.server.ts", () => ({
  requireCuratorOrAdmin: vi.fn(),
  userIsCuratorOrAdmin: vi.fn(),
}));

vi.mock("#app/utils/mention-parser.server.ts", () => ({
  parseMentions: vi.fn(),
}));

vi.mock("#app/utils/db.server.ts", () => ({
  prisma: {
    curatorNote: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

function makeRequest(url: string, method: string, body?: any) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("PUT /api/curator/notes/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCuratorOrAdmin).mockResolvedValue("curator-1");
    vi.mocked(parseMentions).mockResolvedValue([]);
  });

  test("requires curator or admin role", async () => {
    vi.mocked(requireCuratorOrAdmin).mockRejectedValue(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    );

    const request = makeRequest("http://localhost/api/curator/notes/note-1", "PUT", {
      content: "Updated content",
    });

    await expect(
      action({ request, params: { id: "note-1" }, context: {} } as never),
    ).rejects.toThrow();
  });

  test("validates note exists", async () => {
    vi.mocked(prisma.curatorNote.findUnique).mockResolvedValue(null);

    const request = makeRequest("http://localhost/api/curator/notes/note-1", "PUT", {
      content: "Updated content",
    });

    try {
      await action({ request, params: { id: "note-1" }, context: {} } as never);
      expect.unreachable("should have thrown");
    } catch (e: any) {
      expect(e.init.status).toBe(404);
      expect(e.data.message).toContain("Note not found");
    }
  });

  test("validates curator owns note", async () => {
    vi.mocked(prisma.curatorNote.findUnique).mockResolvedValue({
      id: "note-1",
      curatorId: "curator-2", // Different curator
      entityType: "track",
      entityId: "track-1",
    } as never);

    const request = makeRequest("http://localhost/api/curator/notes/note-1", "PUT", {
      content: "Updated content",
    });

    try {
      await action({ request, params: { id: "note-1" }, context: {} } as never);
      expect.unreachable("should have thrown");
    } catch (e: any) {
      expect(e.init.status).toBe(403);
      expect(e.data.message).toContain("You can only edit your own notes");
    }
  });

  test("validates content not empty", async () => {
    vi.mocked(prisma.curatorNote.findUnique).mockResolvedValue({
      id: "note-1",
      curatorId: "curator-1",
      entityType: "track",
      entityId: "track-1",
    } as never);

    const request = makeRequest("http://localhost/api/curator/notes/note-1", "PUT", {
      content: "   ",
    });

    try {
      await action({ request, params: { id: "note-1" }, context: {} } as never);
      expect.unreachable("should have thrown");
    } catch (e: any) {
      expect(e.init.status).toBe(400);
      expect(e.data.message).toContain("cannot be empty");
    }
  });

  test("updates note successfully", async () => {
    vi.mocked(prisma.curatorNote.findUnique).mockResolvedValue({
      id: "note-1",
      curatorId: "curator-1",
      entityType: "track",
      entityId: "track-1",
    } as never);

    vi.mocked(parseMentions).mockResolvedValue(["curator-2"]);

    const mockUpdatedNote = {
      id: "note-1",
      entityType: "track",
      entityId: "track-1",
      curatorId: "curator-1",
      curator: {
        id: "curator-1",
        username: "alice",
        name: "Alice Smith",
      },
      content: "Updated content with @bob",
      mentions: '["curator-2"]',
      parentId: null,
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-02"),
    };

    vi.mocked(prisma.curatorNote.update).mockResolvedValue(mockUpdatedNote as never);

    const request = makeRequest("http://localhost/api/curator/notes/note-1", "PUT", {
      content: "Updated content with @bob",
    });

    const response: any = await action({ request, params: { id: "note-1" }, context: {} } as never);

    expect(response.data.note.content).toBe("Updated content with @bob");
    expect(response.data.note.mentions).toContain("curator-2");
  });
});

describe("DELETE /api/curator/notes/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCuratorOrAdmin).mockResolvedValue("curator-1");
  });

  test("requires curator or admin role", async () => {
    vi.mocked(requireCuratorOrAdmin).mockRejectedValue(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    );

    const request = makeRequest("http://localhost/api/curator/notes/note-1", "DELETE");

    await expect(
      action({ request, params: { id: "note-1" }, context: {} } as never),
    ).rejects.toThrow();
  });

  test("validates note exists", async () => {
    vi.mocked(prisma.curatorNote.findUnique).mockResolvedValue(null);

    const request = makeRequest("http://localhost/api/curator/notes/note-1", "DELETE");

    try {
      await action({ request, params: { id: "note-1" }, context: {} } as never);
      expect.unreachable("should have thrown");
    } catch (e: any) {
      expect(e.init.status).toBe(404);
      expect(e.data.message).toContain("Note not found");
    }
  });

  test("validates curator owns note", async () => {
    vi.mocked(prisma.curatorNote.findUnique).mockResolvedValue({
      id: "note-1",
      curatorId: "curator-2", // Different curator
    } as never);

    const request = makeRequest("http://localhost/api/curator/notes/note-1", "DELETE");

    try {
      await action({ request, params: { id: "note-1" }, context: {} } as never);
      expect.unreachable("should have thrown");
    } catch (e: any) {
      expect(e.init.status).toBe(403);
      expect(e.data.message).toContain("You can only delete your own notes");
    }
  });

  test("deletes note successfully", async () => {
    vi.mocked(prisma.curatorNote.findUnique).mockResolvedValue({
      id: "note-1",
      curatorId: "curator-1",
    } as never);

    vi.mocked(prisma.curatorNote.delete).mockResolvedValue({} as never);

    const request = makeRequest("http://localhost/api/curator/notes/note-1", "DELETE");

    const response: any = await action({ request, params: { id: "note-1" }, context: {} } as never);

    expect(response.data.success).toBe(true);
    expect(prisma.curatorNote.delete).toHaveBeenCalledWith({
      where: { id: "note-1" },
    });
  });
});

describe("clientAction for /api/curator/notes/:id", () => {
  test("forwards edit and delete submissions to the server action", async () => {
    const payload = { success: true };
    const serverAction = vi.fn().mockResolvedValue(payload);

    const result = await clientAction({
      request: new Request("http://localhost/api/curator/notes/note-1", { method: "DELETE" }),
      params: { id: "note-1" },
      serverAction,
    } as never);

    expect(serverAction).toHaveBeenCalledOnce();
    expect(result).toEqual(payload);
  });
});
