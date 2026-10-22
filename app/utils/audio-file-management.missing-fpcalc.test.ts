import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const childProcess = require("node:child_process") as typeof import("node:child_process");
const originalSpawn = childProcess.spawn;

/**
 * Simulates a missing `fpcalc` binary. The fpcalc package calls
 * `spawn("fpcalc", args)` and does not listen for the child `error` event.
 * Forcing PATH empty makes that spawn fail with ENOENT even when fpcalc is installed.
 */
function mockMissingFpcalcBinary(): { spawnCount: () => number } {
  let spawnCount = 0;
  childProcess.spawn = function spawn(command: string, args?: readonly string[], options?: object) {
    if (command === "fpcalc") {
      spawnCount += 1;
      return originalSpawn(command, args ?? [], {
        ...(options ?? {}),
        env: { PATH: "" },
      });
    }
    return originalSpawn(command, args as string[], options as never);
  } as typeof childProcess.spawn;
  return { spawnCount: () => spawnCount };
}

describe("generateAudioFingerprint when the fpcalc binary is missing", () => {
  afterEach(() => {
    childProcess.spawn = originalSpawn;
    vi.resetModules();
  });

  it("returns null instead of an unhandled spawn fpcalc ENOENT", async () => {
    const { consoleError } = await import("#tests/setup/setup-test-env.ts");
    consoleError.mockImplementation(() => {});

    const { spawnCount } = mockMissingFpcalcBinary();
    const stray: Error[] = [];
    const onUncaught = (error: Error) => {
      stray.push(error);
    };
    const onRejection = (reason: unknown) => {
      stray.push(reason instanceof Error ? reason : new Error(String(reason)));
    };
    process.on("uncaughtException", onUncaught);
    process.on("unhandledRejection", onRejection);

    try {
      delete require.cache[require.resolve("fpcalc")];
      vi.resetModules();
      const { generateAudioFingerprint } = await import("./audio-file-management.server.ts");

      const result = await Promise.race([
        generateAudioFingerprint(Buffer.from("not-a-real-audio-file")),
        new Promise<null>((_, reject) => {
          setTimeout(() => {
            reject(
              new Error(
                `fingerprint timed out; stray errors: ${stray.map((error) => error.message).join(" | ") || "(none)"}`,
              ),
            );
          }, 2000);
        }),
      ]);

      expect(stray.map((error) => error.message)).toEqual([]);
      expect(spawnCount()).toBeGreaterThan(0);
      expect(result).toBeNull();
    } finally {
      process.off("uncaughtException", onUncaught);
      process.off("unhandledRejection", onRejection);
      childProcess.spawn = originalSpawn;
    }
  });
});
