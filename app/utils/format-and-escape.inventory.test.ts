import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const APP_DIR = join(fileURLToPath(new URL("..", import.meta.url)));
const BYTES_CANONICAL = join(APP_DIR, "utils", "format-bytes.ts");
const ESCAPE_CANONICAL = join(APP_DIR, "utils", "escape-html.ts");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    if (!/\.(ts|tsx)$/.test(entry)) return [];
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry)) return [];
    return [full];
  });
}

const rel = (p: string) => relative(APP_DIR, p).replaceAll("\\", "/");
const files = walk(APP_DIR);

// Local declarations of a byte formatter or HTML escaper under any common name.
const LOCAL_BYTES_FN =
  /(?:function|const|let)\s+(?:format|humanize|pretty|toHuman)\w*(?:Bytes|FileSize|StorageSaved|ByteSize|FileSizeLabel|HumanSize)\w*\b/i;
// The log-1024 trick or a ["B", "KB", ...] unit table are the signature of a copy.
const BYTES_UNIT_TABLE = /\[\s*["']B["']\s*,\s*["']KB["']/;
const BYTES_LOG_TRICK = /Math\.log\([^)]*\)\s*\/\s*Math\.log\(\s*(?:k|1024)\s*\)/;
const LOCAL_ESCAPE_FN = /(?:function|const|let)\s+(?:escape|sanitize)\w*(?:Html|HTML)\w*\b/;
const ESCAPE_CHAIN = /\.replace\(\s*\/&\/g\s*,\s*["']&amp;["']\s*\)/;

/**
 * Fixed-unit conversions that are NOT unit-adaptive formatters and whose
 * rendered text cannot be expressed by `formatBytes` without changing output.
 * Adding to this list requires a justification.
 */
const FIXED_UNIT_EXEMPTIONS: Record<string, string> = {
  "routes/downloads.tsx": "always-MB cache usage/quota display (fixed unit, 1 and 0 decimals)",
  "routes/music+/services+/local+/upload.tsx":
    "always-MB selected-file size and an MB/s vs KB/s upload *rate* (not a size)",
};
const FIXED_UNIT_PATTERN =
  /\/\s*(?:\(?1024\s*\*\s*1024\)?|1024\s*\/\s*1024|1024)\)?\.toFixed|\bMB\/s\b/;

describe("byte-format inventory", () => {
  test("no local byte-format implementation outside app/utils/format-bytes.ts", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file === BYTES_CANONICAL) continue;
      const src = readFileSync(file, "utf8");
      if (LOCAL_BYTES_FN.test(src) || BYTES_UNIT_TABLE.test(src) || BYTES_LOG_TRICK.test(src)) {
        offenders.push(rel(file));
      }
    }
    expect(
      offenders,
      `Use formatBytes from #app/utils/format-bytes.ts (add options, not a new function):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  test("fixed-unit toFixed conversions are limited to the justified exemptions", () => {
    const offenders: string[] = [];
    const seen = new Set<string>();
    for (const file of files) {
      if (file === BYTES_CANONICAL) continue;
      const src = readFileSync(file, "utf8");
      if (!FIXED_UNIT_PATTERN.test(src)) continue;
      seen.add(rel(file));
      if (!(rel(file) in FIXED_UNIT_EXEMPTIONS)) offenders.push(rel(file));
    }
    expect(offenders, `Unexempted fixed-unit byte math:\n${offenders.join("\n")}`).toEqual([]);
    // Keep the allowlist honest: remove entries that no longer apply.
    expect([...seen].sort()).toEqual(Object.keys(FIXED_UNIT_EXEMPTIONS).sort());
  });
});

describe("html-escape inventory", () => {
  test("no local escapeHtml implementation outside app/utils/escape-html.ts", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file === ESCAPE_CANONICAL) continue;
      const src = readFileSync(file, "utf8");
      if (LOCAL_ESCAPE_FN.test(src) || ESCAPE_CHAIN.test(src)) offenders.push(rel(file));
    }
    expect(
      offenders,
      `Use escapeHtml from #app/utils/escape-html.ts:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  test("the detectors catch a divergent local copy", () => {
    expect(LOCAL_BYTES_FN.test("function formatBytes(b: number) {}")).toBe(true);
    expect(BYTES_UNIT_TABLE.test(`const sizes = ["B", "KB", "MB"];`)).toBe(true);
    expect(LOCAL_ESCAPE_FN.test("function escapeHtml(t: string) {}")).toBe(true);
    expect(ESCAPE_CHAIN.test(`t.replace(/&/g, "&amp;")`)).toBe(true);
  });
});
