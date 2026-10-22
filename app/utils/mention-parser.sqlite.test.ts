import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { getCuratorsForAutocomplete } from "./mention-parser.server.ts";

/**
 * The mocked unit tests never send `contains` filters to SQLite.
 * Prisma's SQLite client rejects `mode` on `contains`, which is what crashes
 * Track Details → Notes when someone types `@kody`.
 */
describe("getCuratorsForAutocomplete against sqlite", () => {
  const suffix = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const curatorUsername = `Kody${suffix}`;
  const nameMatchUsername = `alice${suffix}`;
  const nameMatch = `Alice Smith${suffix}`;
  const outsiderUsername = `fan${suffix}`;
  const createdIds: string[] = [];

  async function ensureRole(name: string) {
    await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name, description: name },
    });
  }

  beforeAll(async () => {
    await ensureRole("curator");
    await ensureRole("admin");
    await ensureRole("user");

    const curator = await prisma.user.create({
      data: {
        email: `curator-${suffix}@example.com`,
        username: curatorUsername,
        name: "Curator Person",
        roles: { connect: { name: "admin" } },
      },
    });
    const named = await prisma.user.create({
      data: {
        email: `named-${suffix}@example.com`,
        username: nameMatchUsername,
        name: nameMatch,
        roles: { connect: { name: "curator" } },
      },
    });
    const outsider = await prisma.user.create({
      data: {
        email: `outsider-${suffix}@example.com`,
        username: outsiderUsername,
        name: `Kody Fan ${suffix}`,
        roles: { connect: { name: "user" } },
      },
    });
    createdIds.push(curator.id, named.id, outsider.id);
  });

  afterAll(async () => {
    if (createdIds.length === 0) return;
    await prisma.user.deleteMany({ where: { id: { in: createdIds } } });
  });

  test("matches curator username and name case-insensitively without throwing", async () => {
    const byUsername = await getCuratorsForAutocomplete(`kody${suffix}`);
    expect(byUsername.map((curator) => curator.username)).toEqual([curatorUsername]);
    expect(byUsername[0]?.displayName).toBe("Curator Person");

    const byUsernameUpper = await getCuratorsForAutocomplete(`KODY${suffix.toUpperCase()}`);
    expect(byUsernameUpper.map((curator) => curator.username)).toEqual([curatorUsername]);

    const byName = await getCuratorsForAutocomplete(`smith${suffix}`);
    expect(byName.map((curator) => curator.username)).toEqual([nameMatchUsername]);

    const byNameUpper = await getCuratorsForAutocomplete(`SMITH${suffix.toUpperCase()}`);
    expect(byNameUpper.map((curator) => curator.username)).toEqual([nameMatchUsername]);

    const outsider = createdIds[2];
    const matchedIds = new Set(
      [byUsername, byUsernameUpper, byName, byNameUpper].flat().map((curator) => curator.id),
    );
    expect(outsider).toBeDefined();
    expect(matchedIds.has(outsider!)).toBe(false);
  });

  test("lists curators for a bare @ without matching listeners", async () => {
    const findMany = vi.spyOn(prisma.user, "findMany");
    await getCuratorsForAutocomplete("");
    const args = findMany.mock.calls.at(-1)?.[0];
    findMany.mockRestore();

    expect(args).toBeDefined();
    expect(JSON.stringify(args)).not.toContain("contains");

    const rows = await prisma.user.findMany({ ...args, take: undefined });
    const usernames = rows.map((row) => row.username);
    expect(usernames).toContain(curatorUsername);
    expect(usernames).toContain(nameMatchUsername);
    expect(usernames).not.toContain(outsiderUsername);
  });

  test("sends query arguments the sqlite client accepts", async () => {
    const findMany = vi.spyOn(prisma.user, "findMany");

    await getCuratorsForAutocomplete(`kody${suffix}`);

    const args = findMany.mock.calls.at(-1)?.[0];
    expect(args).toBeDefined();
    expect(JSON.stringify(args)).not.toContain('"mode"');

    findMany.mockRestore();

    await expect(prisma.user.findMany(args!)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ username: curatorUsername })]),
    );
  });
});
