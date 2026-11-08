import { execSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runPrismaMigrateDeploy } from "../scripts/prisma-migrate-deploy.ts";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("../app/utils/genre-migration.server.ts", () => ({
  backfillLegacyTrackGenresIfNeeded: vi.fn().mockResolvedValue({
    ran: false,
    result: { tracksProcessed: 0, genresCreated: 0, linksCreated: 0 },
  }),
}));

describe("runPrismaMigrateDeploy", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("generates the Prisma client before running the legacy genre backfill", async () => {
    const calls: string[] = [];
    vi.mocked(execSync).mockImplementation((command) => {
      calls.push(String(command));
      return "";
    });

    await runPrismaMigrateDeploy();

    const generateIndex = calls.findIndex((c) => c.includes("prisma generate"));
    const deployIndex = calls.findIndex((c) => c.includes("migrate deploy"));
    expect(generateIndex).toBeGreaterThanOrEqual(0);
    expect(deployIndex).toBeGreaterThan(generateIndex);
  });
});
