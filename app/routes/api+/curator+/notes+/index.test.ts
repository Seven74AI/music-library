import { describe, expect, test, vi, beforeEach } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { requireCuratorOrAdmin } from "#app/utils/curator.server.ts";
import { parseMentions } from "#app/utils/mention-parser.server.ts";
import { loader, action, clientAction } from "./index.ts";

vi.mock("#app/utils/curator.server.ts", () => ({
  requireCuratorOrAdmin: vi.fn(),
}));

vi.mock("#app/utils/mention-parser.server.ts", () => ({
  parseMentions: vi.fn(),
}));

vi.mock("#app/utils/db.server.ts", () => ({
  prisma: {
    curatorNote: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    track: {
      findUnique: vi.fn(),
    },
    artist: {
      findUnique: vi.fn(),
    },
    album: {
      findUnique: vi.fn(),
    },
  },
}));

function makeRequest(url: string, method: string = "GET", body?: any) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("GET /api/curator/notes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCuratorOrAdmin).mockResolvedValue("curator-1");
  });

  test("requires curator or admin role", async () => {
    vi.mocked(requireCuratorOrAdmin).mockRejectedValue(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    );

    const request = makeRequest(
      "http://localhost/api/curator/notes?entityType=track&entityId=track-1",
    );

    await expect(loader({ request, params: {}, context: {} } as never)).rejects.toThrow();
  });

  test("validates required parameters", async () => {
    const request = makeRequest("http://localhost/api/curator/notes");

    try {
      await loader({ request, params: {}, context: {} } as never);
      expect.unreachable("should have thrown");
    } catch (e: any) {
      expect(e.init.status).toBe(400);
      expect(e.data.error).toBe("Validation failed");
    }
  });

  test("validates entityType", async () => {
    const request = makeRequest(
      "http://localhost/api/curator/notes?entityType=invalid&entityId=track-1",
    );

    try {
      await loader({ request, params: {}, context: {} } as never);
      expect.unreachable("should have thrown");
    } catch (e: any) {
      expect(e.init.status).toBe(400);
      expect(e.data.message).toContain("entityType must be");
    }
  });

  test("returns notes for entity", async () => {
    const mockNotes = [
      {
        id: "note-1",
        entityType: "track",
        entityId: "track-1",
        curatorId: "curator-1",
        curator: {
          id: "curator-1",
          username: "alice",
          name: "Alice Smith",
        },
        content: "This needs better metadata",
        mentions: "[]",
        parentId: null,
        replies: [],
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
      },
    ];

    vi.mocked(prisma.curatorNote.findMany).mockResolvedValue(mockNotes as never);

    const request = makeRequest(
      "http://localhost/api/curator/notes?entityType=track&entityId=track-1",
    );

    const response: any = await loader({ request, params: {}, context: {} } as never);

    expect(response.data.notes).toHaveLength(1);
    expect(response.data.notes[0].content).toBe("This needs better metadata");
    expect(response.data.notes[0].curator.displayName).toBe("Alice Smith");
  });

  test("returns threaded notes with replies", async () => {
    const mockNotes = [
      {
        id: "note-1",
        entityType: "track",
        entityId: "track-1",
        curatorId: "curator-1",
        curator: {
          id: "curator-1",
          username: "alice",
          name: "Alice Smith",
        },
        content: "Parent note",
        mentions: "[]",
        parentId: null,
        replies: [
          {
            id: "note-2",
            entityType: "track",
            entityId: "track-1",
            curatorId: "curator-2",
            curator: {
              id: "curator-2",
              username: "bob",
              name: "Bob Jones",
            },
            content: "Reply to parent",
            mentions: "[]",
            parentId: "note-1",
            createdAt: new Date("2024-01-02"),
            updatedAt: new Date("2024-01-02"),
          },
        ],
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
      },
    ];

    vi.mocked(prisma.curatorNote.findMany).mockResolvedValue(mockNotes as never);

    const request = makeRequest(
      "http://localhost/api/curator/notes?entityType=track&entityId=track-1",
    );

    const response: any = await loader({ request, params: {}, context: {} } as never);

    expect(response.data.notes).toHaveLength(1);
    expect(response.data.notes[0].replies).toHaveLength(1);
    expect(response.data.notes[0].replies[0].content).toBe("Reply to parent");
  });
});

describe("POST /api/curator/notes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCuratorOrAdmin).mockResolvedValue("curator-1");
    vi.mocked(parseMentions).mockResolvedValue([]);
  });

  test("requires curator or admin role", async () => {
    vi.mocked(requireCuratorOrAdmin).mockRejectedValue(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    );

    const request = makeRequest("http://localhost/api/curator/notes", "POST", {
      entityType: "track",
      entityId: "track-1",
      content: "Test note",
    });

    await expect(action({ request, params: {}, context: {} } as never)).rejects.toThrow();
  });

  test("validates required fields", async () => {
    const request = makeRequest("http://localhost/api/curator/notes", "POST", {
      entityType: "track",
    });

    try {
      await action({ request, params: {}, context: {} } as never);
      expect.unreachable("should have thrown");
    } catch (e: any) {
      expect(e.init.status).toBe(400);
      expect(e.data.error).toBe("Validation failed");
    }
  });

  test("validates content not empty", async () => {
    const request = makeRequest("http://localhost/api/curator/notes", "POST", {
      entityType: "track",
      entityId: "track-1",
      content: "   ",
    });

    try {
      await action({ request, params: {}, context: {} } as never);
      expect.unreachable("should have thrown");
    } catch (e: any) {
      expect(e.init.status).toBe(400);
      expect(e.data.message).toContain("cannot be empty");
    }
  });

  test("validates content length", async () => {
    const longContent = "a".repeat(5001);
    const request = makeRequest("http://localhost/api/curator/notes", "POST", {
      entityType: "track",
      entityId: "track-1",
      content: longContent,
    });

    try {
      await action({ request, params: {}, context: {} } as never);
      expect.unreachable("should have thrown");
    } catch (e: any) {
      expect(e.init.status).toBe(400);
      expect(e.data.message).toContain("cannot exceed 5000 characters");
    }
  });

  test("validates entity exists", async () => {
    vi.mocked(prisma.track.findUnique).mockResolvedValue(null);

    const request = makeRequest("http://localhost/api/curator/notes", "POST", {
      entityType: "track",
      entityId: "track-1",
      content: "Test note",
    });

    try {
      await action({ request, params: {}, context: {} } as never);
      expect.unreachable("should have thrown");
    } catch (e: any) {
      expect(e.init.status).toBe(404);
      expect(e.data.message).toContain("Track not found");
    }
  });

  test("creates note with mentions", async () => {
    vi.mocked(prisma.track.findUnique).mockResolvedValue({ id: "track-1" } as never);
    vi.mocked(parseMentions).mockResolvedValue(["curator-2"]);

    const mockNote = {
      id: "note-1",
      entityType: "track",
      entityId: "track-1",
      curatorId: "curator-1",
      curator: {
        id: "curator-1",
        username: "alice",
        name: "Alice Smith",
      },
      content: "Hey @bob can you check this?",
      mentions: '["curator-2"]',
      parentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(prisma.curatorNote.create).mockResolvedValue(mockNote as never);

    const request = makeRequest("http://localhost/api/curator/notes", "POST", {
      entityType: "track",
      entityId: "track-1",
      content: "Hey @bob can you check this?",
    });

    const response: any = await action({ request, params: {}, context: {} } as never);

    expect(response.data.note).toBeDefined();
    expect(response.data.note.content).toBe("Hey @bob can you check this?");
    expect(response.data.note.mentions).toContain("curator-2");
    expect(parseMentions).toHaveBeenCalledWith("Hey @bob can you check this?");
  });

  test("creates reply to parent note", async () => {
    vi.mocked(prisma.track.findUnique).mockResolvedValue({ id: "track-1" } as never);
    vi.mocked(prisma.curatorNote.findUnique).mockResolvedValue({
      id: "note-1",
      entityType: "track",
      entityId: "track-1",
    } as never);

    const mockNote = {
      id: "note-2",
      entityType: "track",
      entityId: "track-1",
      curatorId: "curator-1",
      curator: {
        id: "curator-1",
        username: "alice",
        name: "Alice Smith",
      },
      content: "This is a reply",
      mentions: "[]",
      parentId: "note-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(prisma.curatorNote.create).mockResolvedValue(mockNote as never);

    const request = makeRequest("http://localhost/api/curator/notes", "POST", {
      entityType: "track",
      entityId: "track-1",
      content: "This is a reply",
      parentId: "note-1",
    });

    const response: any = await action({ request, params: {}, context: {} } as never);

    expect(response.data.note.parentId).toBe("note-1");
  });

  test("validates parent note belongs to same entity", async () => {
    vi.mocked(prisma.track.findUnique).mockResolvedValue({ id: "track-1" } as never);
    vi.mocked(prisma.curatorNote.findUnique).mockResolvedValue({
      id: "note-1",
      entityType: "track",
      entityId: "track-2", // Different entity
    } as never);

    const request = makeRequest("http://localhost/api/curator/notes", "POST", {
      entityType: "track",
      entityId: "track-1",
      content: "This is a reply",
      parentId: "note-1",
    });

    try {
      await action({ request, params: {}, context: {} } as never);
      expect.unreachable("should have thrown");
    } catch (e: any) {
      expect(e.init.status).toBe(400);
      expect(e.data.message).toContain("must be for the same entity");
    }
  });
});

describe("clientAction for /api/curator/notes", () => {
  test("forwards the fetcher submission to the server action", async () => {
    const payload = { note: { id: "note-1" } };
    const serverAction = vi.fn().mockResolvedValue(payload);

    const result = await clientAction({
      request: new Request("http://localhost/api/curator/notes", { method: "POST" }),
      params: {},
      serverAction,
    } as never);

    expect(serverAction).toHaveBeenCalledOnce();
    expect(result).toEqual(payload);
  });
});
