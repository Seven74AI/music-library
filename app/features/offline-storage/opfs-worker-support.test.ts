import { describe, expect, test } from "vitest";
import { isOpfsSupportedInWorkerScope } from "./opfs-worker-support.ts";

const withGetDirectory = { navigator: { storage: { getDirectory: () => {} } } };

describe("isOpfsSupportedInWorkerScope", () => {
  test("true when getDirectory and createSyncAccessHandle are both present", () => {
    const scope = {
      ...withGetDirectory,
      FileSystemFileHandle: { prototype: { createSyncAccessHandle: () => {} } },
    };
    expect(isOpfsSupportedInWorkerScope(scope)).toBe(true);
  });

  test("false when getDirectory is missing", () => {
    const scope = {
      navigator: { storage: {} },
      FileSystemFileHandle: { prototype: { createSyncAccessHandle: () => {} } },
    };
    expect(isOpfsSupportedInWorkerScope(scope)).toBe(false);
  });

  test("false when createSyncAccessHandle is missing (worker-only API)", () => {
    const scope = {
      ...withGetDirectory,
      FileSystemFileHandle: { prototype: {} },
    };
    expect(isOpfsSupportedInWorkerScope(scope)).toBe(false);
  });

  test("false when FileSystemFileHandle constructor is absent", () => {
    expect(isOpfsSupportedInWorkerScope(withGetDirectory)).toBe(false);
  });

  test("false when navigator or storage is absent", () => {
    expect(isOpfsSupportedInWorkerScope({})).toBe(false);
    expect(isOpfsSupportedInWorkerScope({ navigator: {} })).toBe(false);
  });
});
