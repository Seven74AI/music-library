import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const APP_DIR = join(fileURLToPath(new URL("..", import.meta.url)));
const CANONICAL = join(APP_DIR, "utils", "prisma-errors.ts");

const LOCAL_UNIQUE_HELPER =
  /function\s+isUniqueConstraint(?:Error|Violation)\s*\([^)]*\)\s*(?::\s*boolean)?\s*\{[\s\S]*?P2002/;

function walkAppSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) return walkAppSourceFiles(fullPath);
    if (!/\.(ts|tsx)$/.test(entry)) return [];
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry)) return [];
    return [fullPath];
  });
}

describe("prisma-errors inventory", () => {
  test("isUniqueConstraintError is defined only in app/utils/prisma-errors.ts", () => {
    const offenders: string[] = [];

    for (const filePath of walkAppSourceFiles(APP_DIR)) {
      if (filePath === CANONICAL) continue;
      const source = readFileSync(filePath, "utf8");
      if (LOCAL_UNIQUE_HELPER.test(source)) {
        offenders.push(relative(process.cwd(), filePath));
      }
    }

    expect(
      offenders,
      `Local P2002 unique-constraint helpers must import from #app/utils/prisma-errors.ts:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
