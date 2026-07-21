import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

describe("build-sw precache config", () => {
  test("does not add index.html twice (glob + additionalPrecacheEntries)", async () => {
    const source = await fs.readFile(path.join(process.cwd(), "scripts/build-sw.ts"), "utf8");

    expect(source).toContain("writeProdOfflineShell(clientDir)");
    expect(source).toMatch(/globPatterns:.*html/);
    expect(source).not.toMatch(/additionalPrecacheEntries\s*:/);
  });
});
