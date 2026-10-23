import { describe, expect, test } from "vitest";
import { resetTestDatabase } from "#tests/setup/reset-test-database.ts";

describe("resetTestDatabase", () => {
  test("restores the seeded database after destructive writes", async () => {
    const { prisma } = await import("#app/utils/db.server.ts");
    const seededCount = await prisma.user.count();
    expect(seededCount).toBeGreaterThan(0);

    await prisma.user.deleteMany();
    expect(await prisma.user.count()).toBe(0);

    await resetTestDatabase();

    const { prisma: freshPrisma } = await import("#app/utils/db.server.ts");
    expect(await freshPrisma.user.count()).toBe(seededCount);
  });
});
