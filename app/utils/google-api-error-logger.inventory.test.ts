import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const APP_DIR = join(fileURLToPath(new URL("..", import.meta.url)));
const LOGGER_CANONICAL = join(APP_DIR, "utils", "google-api-error-logger.server.ts");

const GOOGLE_CONTEXT =
  /googleapis|google\.youtube|oauth2Client|GaxiosError|getTokens|setCredentials|videos\.list|createYouTubeOAuth|YouTubeOAuth|youtube-oauth/;

const RAW_ERROR_LOG =
  /console\.(error|warn|log)\s*\(\s*(?:[^)]*,\s*)?(?:error|err|callbackError|e)\s*,?\s*\)/g;

function walkAppSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) return walkAppSourceFiles(fullPath);
    if (!/\.(ts|tsx)$/.test(entry)) return [];
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry)) return [];
    return [fullPath];
  });
}

describe("google-api-error-logger inventory", () => {
  test("Google/OAuth paths do not console.log raw error objects", () => {
    const offenders: string[] = [];

    for (const filePath of walkAppSourceFiles(APP_DIR)) {
      if (filePath === LOGGER_CANONICAL) continue;

      const source = readFileSync(filePath, "utf8");
      if (!GOOGLE_CONTEXT.test(source)) continue;

      // Match against the whole file so prettier-wrapped multi-line calls are caught.
      for (const match of source.matchAll(RAW_ERROR_LOG)) {
        const text = match[0];

        const lineNo = source.slice(0, match.index).split("\n").length;
        offenders.push(
          `${relative(process.cwd(), filePath)}:${lineNo}: ${text.replace(/\s+/g, " ")}`,
        );
      }
    }

    expect(
      offenders,
      `Raw Google client errors must use logGoogleApiError:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
