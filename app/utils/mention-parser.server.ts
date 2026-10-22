import { prisma } from "./db.server.ts";

/**
 * Parse @mentions from note content
 * Supports: @username or @"Full Name"
 * Returns array of user IDs
 */
export async function parseMentions(content: string): Promise<string[]> {
  // Regex to match @username or @"Full Name"
  const mentionPattern = /@"([^"]+)"|@(\w+)/g;
  const matches = [...content.matchAll(mentionPattern)];

  if (matches.length === 0) {
    return [];
  }

  // Extract usernames or names
  const identifiers = matches
    .map((match) => match[1] || match[2])
    .filter((id): id is string => !!id);

  // Query database to resolve usernames/names to user IDs
  const users = await prisma.user.findMany({
    where: {
      OR: [{ username: { in: identifiers } }, { name: { in: identifiers } }],
    },
    select: {
      id: true,
      username: true,
      name: true,
    },
  });

  // Create a map for quick lookup
  const userMap = new Map<string, string>();
  users.forEach((user) => {
    if (user.username) userMap.set(user.username, user.id);
    if (user.name) userMap.set(user.name, user.id);
  });

  // Resolve identifiers to user IDs
  const userIds = new Set<string>();
  identifiers.forEach((identifier) => {
    const userId = userMap.get(identifier);
    if (userId) {
      userIds.add(userId);
    }
  });

  return Array.from(userIds);
}

/**
 * Get curators for autocomplete
 * Returns users with curator or admin role
 */
export async function getCuratorsForAutocomplete(query: string) {
  // Prisma's SQLite client rejects `mode` on `contains` (`Unknown argument mode`).
  // SQLite `contains` is already case-insensitive for ASCII, which covers @mentions.
  // An empty query is the bare "@" menu and should list curators, not match nothing.
  const curators = await prisma.user.findMany({
    where: {
      ...(query ? { OR: [{ username: { contains: query } }, { name: { contains: query } }] } : {}),
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

  return curators.map((curator) => ({
    id: curator.id,
    username: curator.username,
    name: curator.name,
    displayName: curator.name || curator.username,
  }));
}
