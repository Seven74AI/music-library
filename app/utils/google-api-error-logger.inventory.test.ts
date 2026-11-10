import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const APP_DIR = join(fileURLToPath(new URL("..", import.meta.url)));
const LOGGER_CANONICAL = join(APP_DIR, "utils", "google-api-error-logger.server.ts");

const GOOGLE_CONTEXT =
  /googleapis|google\.youtube|oauth2Client|GaxiosError|getTokens|setCredentials|videos\.list/;

const RAW_ERROR_LOG =
  /console\.(error|warn|log)\s*\(\s*[^)]*,\s*(?:error|err|callbackError|e)\s*\)/;

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

      const lines = source.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (!RAW_ERROR_LOG.test(line)) continue;
        if (line.includes("logGoogleApiError")) continue;
        if (line.includes("logGoogleOAuthClientError")) continue;
        if (line.includes("logGoogleYouTubeDataApiClientError")) continue;

        offenders.push(`${relative(process.cwd(), filePath)}:${i + 1}: ${line.trim()}`);
      }
    }

    expect(
      offenders,
      `Raw Google client errors must use logGoogleApiError:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
