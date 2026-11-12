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

  const usernameMentions: string[] = [];
  const nameMentions: string[] = [];
  for (const match of matches) {
    if (match[1]) {
      nameMentions.push(match[1]);
    } else if (match[2]) {
      usernameMentions.push(match[2].toLowerCase());
    }
  }

  const orFilters: Array<{ username: { in: string[] } } | { name: { in: string[] } }> = [];
  if (usernameMentions.length > 0) {
    orFilters.push({ username: { in: usernameMentions } });
  }
  if (nameMentions.length > 0) {
    orFilters.push({ name: { in: nameMentions } });
  }

  // Query database to resolve usernames/names to user IDs
  const users = await prisma.user.findMany({
    where: { OR: orFilters },
    select: {
      id: true,
      username: true,
      name: true,
    },
  });

  const usernameMap = new Map<string, string>();
  const nameMap = new Map<string, string>();
  for (const user of users) {
    if (user.username) usernameMap.set(user.username.toLowerCase(), user.id);
    if (user.name) nameMap.set(user.name, user.id);
  }

  const userIds = new Set<string>();
  for (const match of matches) {
    if (match[1]) {
      const userId = nameMap.get(match[1]);
      if (userId) userIds.add(userId);
    } else if (match[2]) {
      const userId = usernameMap.get(match[2].toLowerCase());
      if (userId) userIds.add(userId);
    }
  }

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
