import { describe, expect, test, vi, beforeEach } from "vitest";
import { parseMentions, getCuratorsForAutocomplete } from "./mention-parser.server.ts";
import { prisma } from "./db.server.ts";

vi.mock("./db.server.ts", () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
    },
  },
}));

describe("parseMentions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("extracts username mentions", async () => {
    const content = "Hey @alice can you check this?";

    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "user-1", username: "alice", name: "Alice Smith" },
    ] as never);

    const mentions = await parseMentions(content);

    expect(mentions).toEqual(["user-1"]);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        OR: [{ username: { in: ["alice"] } }, { name: { in: ["alice"] } }],
      },
      select: { id: true, username: true, name: true },
    });
  });

  test("extracts multiple username mentions", async () => {
    const content = "Hey @alice and @bob, please review this";

    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "user-1", username: "alice", name: "Alice Smith" },
      { id: "user-2", username: "bob", name: "Bob Jones" },
    ] as never);

    const mentions = await parseMentions(content);

    expect(mentions).toHaveLength(2);
    expect(mentions).toContain("user-1");
    expect(mentions).toContain("user-2");
  });

  test("extracts quoted name mentions", async () => {
    const content = 'Hey @"Alice Smith" can you check this?';

    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "user-1", username: "alice", name: "Alice Smith" },
    ] as never);

    const mentions = await parseMentions(content);

    expect(mentions).toEqual(["user-1"]);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        OR: [{ username: { in: ["Alice Smith"] } }, { name: { in: ["Alice Smith"] } }],
      },
      select: { id: true, username: true, name: true },
    });
  });

  test("handles mixed mentions", async () => {
    const content = '@alice and @"Bob Jones" please review';

    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "user-1", username: "alice", name: "Alice Smith" },
      { id: "user-2", username: "bob", name: "Bob Jones" },
    ] as never);

    const mentions = await parseMentions(content);

    expect(mentions).toHaveLength(2);
    expect(mentions).toContain("user-1");
    expect(mentions).toContain("user-2");
  });

  test("returns empty array for no mentions", async () => {
    const content = "This is a note with no mentions";

    const mentions = await parseMentions(content);

    expect(mentions).toEqual([]);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  test("handles non-existent users", async () => {
    const content = "@alice @nonexistent @bob";

    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "user-1", username: "alice", name: "Alice Smith" },
      { id: "user-2", username: "bob", name: "Bob Jones" },
    ] as never);

    const mentions = await parseMentions(content);

    expect(mentions).toHaveLength(2);
    expect(mentions).not.toContain("nonexistent");
  });

  test("deduplicates mentions of same user", async () => {
    const content = "@alice please check this @alice";

    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "user-1", username: "alice", name: "Alice Smith" },
    ] as never);

    const mentions = await parseMentions(content);

    expect(mentions).toEqual(["user-1"]);
  });

  test("handles mentions at start and end", async () => {
    const content = "@alice this is important @bob";

    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "user-1", username: "alice", name: "Alice Smith" },
      { id: "user-2", username: "bob", name: "Bob Jones" },
    ] as never);

    const mentions = await parseMentions(content);

    expect(mentions).toHaveLength(2);
  });
});

describe("getCuratorsForAutocomplete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns curators matching query", async () => {
    const mockCurators = [
      { id: "user-1", username: "alice", name: "Alice Smith" },
      { id: "user-2", username: "alice_jones", name: "Alice Jones" },
    ];

    vi.mocked(prisma.user.findMany).mockResolvedValue(mockCurators as never);

    const results = await getCuratorsForAutocomplete("ali");

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      id: "user-1",
      username: "alice",
      name: "Alice Smith",
      displayName: "Alice Smith",
    });
    expect(results[1]).toEqual({
      id: "user-2",
      username: "alice_jones",
      name: "Alice Jones",
      displayName: "Alice Jones",
    });
  });

  test("uses username as displayName when name is null", async () => {
    const mockCurators = [{ id: "user-1", username: "alice", name: null }];

    vi.mocked(prisma.user.findMany).mockResolvedValue(mockCurators as never);

    const results = await getCuratorsForAutocomplete("ali");

    expect(results[0]?.displayName).toBe("alice");
  });

  test("queries both username and name", async () => {
    const query = "smith";

    vi.mocked(prisma.user.findMany).mockResolvedValue([]);

    await getCuratorsForAutocomplete(query);

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        OR: [{ username: { contains: query } }, { name: { contains: query } }],
        roles: {
          some: {
            name: { in: ["curator", "admin"] },
          },
        },
      },
      orderBy: { username: "asc" },
      select: {
        id: true,
        username: true,
        name: true,
      },
      take: 10,
    });
  });

  test("limits results to 10", async () => {
    const mockCurators = Array.from({ length: 15 }, (_, i) => ({
      id: `user-${i}`,
      username: `alice${i}`,
      name: `Alice ${i}`,
    }));

    vi.mocked(prisma.user.findMany).mockResolvedValue(mockCurators.slice(0, 10) as never);

    const results = await getCuratorsForAutocomplete("alice");

    expect(results).toHaveLength(10);
  });

  test("returns empty array for no matches", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);

    const results = await getCuratorsForAutocomplete("xyz");

    expect(results).toEqual([]);
  });
});
