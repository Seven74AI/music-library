import { afterEach, describe, expect, it, vi } from "vitest";
import {
  drainInProcessJobStoppers,
  registerInProcessJobStopper,
} from "./in-process-job-registry.server.ts";

afterEach(() => {
  void drainInProcessJobStoppers();
});

describe("in-process job registry", () => {
  it("drainInProcessJobStoppers invokes every registered stopper and clears the registry", async () => {
    const a = vi.fn();
    const b = vi.fn();

    registerInProcessJobStopper("a", a);
    registerInProcessJobStopper("b", b);

    await drainInProcessJobStoppers();

    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();

    await drainInProcessJobStoppers();
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it("re-registering the same id replaces the previous stopper", async () => {
    const first = vi.fn();
    const second = vi.fn();

    registerInProcessJobStopper("job", first);
    registerInProcessJobStopper("job", second);

    await drainInProcessJobStoppers();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("global drain hook invokes registered stoppers without a server bundle import", async () => {
    globalThis.__drainInProcessJobStoppers = drainInProcessJobStoppers;
    const stop = vi.fn();
    registerInProcessJobStopper("cross-bundle", stop);

    await globalThis.__drainInProcessJobStoppers!();

    expect(stop).toHaveBeenCalledOnce();
    delete globalThis.__drainInProcessJobStoppers;
  });

  it("awaits async stoppers", async () => {
    const order: string[] = [];
    registerInProcessJobStopper("async", async () => {
      await Promise.resolve();
      order.push("stopped");
    });

    order.push("before");
    await drainInProcessJobStoppers();
    order.push("after");

    expect(order).toEqual(["before", "stopped", "after"]);
  });
});
