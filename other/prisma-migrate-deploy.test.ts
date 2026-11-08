import { execSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runPrismaMigrateDeploy } from "../scripts/prisma-migrate-deploy.ts";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("../scripts/legacy-track-genre-backfill.ts", () => ({
  backfillLegacyTrackGenresIfNeeded: vi.fn().mockResolvedValue({
    ran: false,
    result: { tracksProcessed: 0, genresCreated: 0, linksCreated: 0 },
  }),
}));

describe("runPrismaMigrateDeploy", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("runs the legacy genre backfill before prisma migrate deploy (no prisma generate)", async () => {
    const calls: string[] = [];
    vi.mocked(execSync).mockImplementation((command) => {
      calls.push(String(command));
      return "";
    });

    const { backfillLegacyTrackGenresIfNeeded } =
      await import("../scripts/legacy-track-genre-backfill.ts");

    await runPrismaMigrateDeploy();

    expect(backfillLegacyTrackGenresIfNeeded).toHaveBeenCalled();
    expect(calls.some((c) => c.includes("prisma generate"))).toBe(false);
    expect(calls.find((c) => c.includes("migrate deploy"))).toBeDefined();
  });
});
