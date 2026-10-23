import { afterEach, describe, expect, test, vi } from "vitest";
import { isOpfsAudioStoreSupported } from "./opfs-audio-store.client.ts";

/**
 * @vitest-environment jsdom
 */

type Listener = (event: { data: unknown }) => void;

class FakeWorker {
  static instances: FakeWorker[] = [];
  private listeners = new Map<string, Listener[]>();
  posted: unknown[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  postMessage(message: unknown) {
    this.posted.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  respond(data: unknown) {
    for (const listener of this.listeners.get("message") ?? []) {
      listener({ data });
    }
  }

  error() {
    for (const listener of this.listeners.get("error") ?? []) {
      listener({ data: null });
    }
  }
}

afterEach(() => {
  FakeWorker.instances = [];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("isOpfsAudioStoreSupported", () => {
  test("returns false when Worker is unavailable", async () => {
    vi.stubGlobal("Worker", undefined);
    await expect(isOpfsAudioStoreSupported()).resolves.toBe(false);
  });

  test("returns true when the worker reports OPFS support", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const promise = isOpfsAudioStoreSupported();
    const worker = FakeWorker.instances[0]!;
    expect(worker.posted).toEqual([{ type: "probe", id: 0 }]);
    worker.respond({ id: 0, ok: true, supported: true });
    await expect(promise).resolves.toBe(true);
    expect(worker.terminated).toBe(true);
  });

  test("returns false when the worker reports no OPFS support", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const promise = isOpfsAudioStoreSupported();
    FakeWorker.instances[0]!.respond({ id: 0, ok: true, supported: false });
    await expect(promise).resolves.toBe(false);
  });

  test("returns false when the worker errors", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const promise = isOpfsAudioStoreSupported();
    FakeWorker.instances[0]!.error();
    await expect(promise).resolves.toBe(false);
  });

  test("times out to false when the worker never responds", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FakeWorker);
    const promise = isOpfsAudioStoreSupported();
    await vi.advanceTimersByTimeAsync(2000);
    await expect(promise).resolves.toBe(false);
  });
});
