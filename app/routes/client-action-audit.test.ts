import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const ROUTES_DIR = join(fileURLToPath(new URL(".", import.meta.url)));

/**
 * Action-only routes hit via raw fetch/XHR (not React Router Form/fetcher).
 * Those POSTs go straight to the server action and do not need clientAction.
 */
const ACTION_ONLY_RAW_FETCH_ALLOWLIST = new Set([
  "api+/upload-audio.tsx",
  "api+/upload-audio-batch.tsx",
  "api+/extract-metadata.tsx",
  "_auth+/webauthn+/registration.ts",
  "_auth+/webauthn+/authentication.ts",
]);

function walkFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) return walkFiles(fullPath);
    if (/\.(tsx|ts)$/.test(entry)) return [fullPath];
    return [];
  });
}

function hasExportedAction(source: string): boolean {
  return /export\s+(async\s+)?function\s+action\s*\(/.test(source);
}

function hasClientAction(source: string): boolean {
  return /export\s+(async\s+)?function\s+clientAction\s*\(/.test(source);
}

function hasDefaultExport(source: string): boolean {
  return /export\s+default\b/.test(source);
}

function usesFetcherInRouteModule(source: string): boolean {
  return /\buseFetcher\s*[<(]/.test(source);
}

function submitsToOwnAction(source: string): boolean {
  if (/<[\w$]+\.Form\b(?![^>]*\baction=)/.test(source)) {
    return true;
  }

  for (const match of source.matchAll(/\.submit\(([\s\S]*?)\)/g)) {
    const args = match[1] ?? "";
    if (!/method:\s*['"]post['"]/i.test(args)) continue;

    const optionsMatch = args.match(/,\s*\{([\s\S]*)\}\s*$/);
    if (!optionsMatch) continue;

    const options = optionsMatch[1] ?? "";
    if (!/\baction\s*:/.test(options)) return true;
  }

  return false;
}

describe("clientAction audit", () => {
  const routeFiles = walkFiles(ROUTES_DIR).filter(
    (path) =>
      !path.endsWith(".test.ts") &&
      !path.endsWith(".test.tsx") &&
      !path.includes(".server."),
  );

  test("routes using useFetcher to submit to their own action export clientAction", () => {
    const missing: string[] = [];

    for (const filePath of routeFiles) {
      const source = readFileSync(filePath, "utf8");
      if (!hasExportedAction(source) || !usesFetcherInRouteModule(source)) continue;
      if (!submitsToOwnAction(source)) continue;
      if (!hasClientAction(source)) {
        missing.push(relative(process.cwd(), filePath));
      }
    }

    expect(missing, `Missing clientAction:\n${missing.join("\n")}`).toEqual([]);
  });

  test("action-only route modules export clientAction", () => {
    const missing: string[] = [];

    for (const filePath of routeFiles) {
      const rel = relative(ROUTES_DIR, filePath);
      if (ACTION_ONLY_RAW_FETCH_ALLOWLIST.has(rel)) continue;

      const source = readFileSync(filePath, "utf8");
      if (!hasExportedAction(source) || hasDefaultExport(source)) continue;
      if (!hasClientAction(source)) {
        missing.push(relative(process.cwd(), filePath));
      }
    }

    expect(missing, `Missing clientAction:\n${missing.join("\n")}`).toEqual([]);
  });
});
