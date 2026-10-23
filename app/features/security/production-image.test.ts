import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ignore from "ignore";
import { describe, expect, test } from "vitest";

const SECURITY_EVENTS_MIGRATION =
  "prisma/migrations/20260926120000_add_security_events/migration.sql";
/** SHA-256 of the migration after production's one-time repair. Do not edit that file. */
const SECURITY_EVENTS_MIGRATION_SHA256 =
  "c31b9dfa2518e7acc69eea0bb1e275b96adfe2aa1aee710ce1ce7a0116bc2238";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Whether a path is excluded by a .dockerignore file. Uses the `ignore` package,
 * which implements the same gitignore-style semantics Docker uses (anchored and
 * unanchored patterns, `**`, negation, directory-only rules) rather than a
 * hand-rolled regex that only approximated them.
 */
function dockerignoreExcludes(ignoreFile: string, relativePath: string): boolean {
  const normalized = relativePath.replace(/^\.\//, "").replaceAll("\\", "/");
  return ignore().add(ignoreFile).ignores(normalized);
}

function startupScripts(litefs: string): string[] {
  return [...litefs.matchAll(/^\s*-\s+cmd:\s+node\s+\.\/(\S+)/gm)].map((match) => match[1] ?? "");
}

describe("production image startup scripts", () => {
  test("ships every node script LiteFS runs before the server starts", () => {
    const ignoreFile = fs.readFileSync(
      path.join(repoRoot, "other/Dockerfile.dockerignore"),
      "utf8",
    );
    const litefs = fs.readFileSync(path.join(repoRoot, "other/litefs.yml"), "utf8");
    const dockerfile = fs.readFileSync(path.join(repoRoot, "other/Dockerfile"), "utf8");

    for (const script of startupScripts(litefs)) {
      expect(dockerignoreExcludes(ignoreFile, script), script).toBe(false);
      expect(fs.existsSync(path.join(repoRoot, script)), script).toBe(true);
      expect(dockerfile, script).toContain(script);
    }
  });

  test("keeps the applied security-events migration bytes pinned", () => {
    const sql = fs.readFileSync(path.join(repoRoot, SECURITY_EVENTS_MIGRATION));
    expect(createHash("sha256").update(sql).digest("hex")).toBe(SECURITY_EVENTS_MIGRATION_SHA256);
  });
});
