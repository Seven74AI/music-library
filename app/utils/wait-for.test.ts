import { afterEach, describe, expect, test, vi } from "vitest";
import { waitFor } from "#tests/wait-for.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("waitFor", () => {
  test("returns falsy values instead of re-polling", async () => {
    expect(await waitFor(() => 0)).toBe(0);
    expect(await waitFor(() => false)).toBe(false);
    expect(await waitFor(() => "")).toBe("");
  });

  test("re-polls until the callback returns a non-nullish value", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const pending = waitFor(() => {
      calls += 1;
      return calls === 3 ? "ready" : null;
    });
    const expectation = expect(pending).resolves.toBe("ready");
    await vi.advanceTimersByTimeAsync(1_000);
    await expectation;
    expect(calls).toBe(3);
  });

  test("throws the last error the callback threw", async () => {
    vi.useFakeTimers();
    const pending = waitFor(() => {
      throw new Error("boom");
    });
    const expectation = expect(pending).rejects.toThrow("boom");
    await vi.advanceTimersByTimeAsync(5_000);
    await expectation;
  });

  test("throws the provided errorMessage when the callback never resolves", async () => {
    vi.useFakeTimers();
    const pending = waitFor(() => undefined, { errorMessage: "waiting for inbox" });
    const expectation = expect(pending).rejects.toThrow("waiting for inbox");
    await vi.advanceTimersByTimeAsync(5_000);
    await expectation;
  });

  test("falls back to a non-empty message when no errorMessage is given", async () => {
    vi.useFakeTimers();
    const pending = waitFor(() => undefined);
    const expectation = expect(pending).rejects.toThrow("waitFor timed out");
    await vi.advanceTimersByTimeAsync(5_000);
    await expectation;
  });
});
