/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import {
  isManifestVersionMismatchError,
  MANIFEST_MISMATCH_MESSAGE,
  tryRecoverFromManifestMismatch,
} from "./manifest-mismatch.ts";

describe("manifest mismatch recovery", () => {
  it("detects the RR fog-of-war error message", () => {
    expect(isManifestVersionMismatchError(new Error(MANIFEST_MISMATCH_MESSAGE))).toBe(true);
    expect(isManifestVersionMismatchError(new Error("other"))).toBe(false);
    expect(isManifestVersionMismatchError("string")).toBe(false);
  });

  it("clears the RR loop-guard and reloads once", () => {
    const storage = {
      store: new Map<string, string>([["react-router-manifest-version", "abc"]]),
      getItem(key: string) {
        return this.store.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        this.store.set(key, value);
      },
      removeItem(key: string) {
        this.store.delete(key);
      },
    };
    const reload = vi.fn();

    expect(
      tryRecoverFromManifestMismatch(new Error(MANIFEST_MISMATCH_MESSAGE), storage, reload),
    ).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(storage.getItem("react-router-manifest-version")).toBeNull();
    expect(storage.getItem("en-manifest-mismatch-recovery")).toBe("1");
  });

  it("does not reload a second time in the same session", () => {
    const storage = {
      store: new Map<string, string>([["en-manifest-mismatch-recovery", "1"]]),
      getItem(key: string) {
        return this.store.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        this.store.set(key, value);
      },
      removeItem(key: string) {
        this.store.delete(key);
      },
    };
    const reload = vi.fn();

    expect(
      tryRecoverFromManifestMismatch(new Error(MANIFEST_MISMATCH_MESSAGE), storage, reload),
    ).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(storage.getItem("en-manifest-mismatch-recovery")).toBeNull();
  });
});
