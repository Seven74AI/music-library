import { beforeEach, describe, expect, test, vi } from "vitest";
import { ensureInstance } from "litefs-js/remix";
import {
  assertReplayInstanceAllowed,
  ensureAllowedInstance,
} from "./litefs-replay-instance.server.ts";

vi.mock("litefs-js/remix", async (importOriginal) => {
  const actual = await importOriginal<typeof import("litefs-js/remix")>();
  return {
    ...actual,
    ensureInstance: vi.fn(),
  };
});

const allowed = {
  "5ef6ddf5": "sjc",
  abc12345: "iad",
};

function expectBadRequest(fn: () => void) {
  try {
    fn();
    throw new Error("expected throw");
  } catch (error) {
    expect(error).toBeInstanceOf(Response);
    expect((error as Response).status).toBe(400);
  }
}

describe("assertReplayInstanceAllowed", () => {
  test("rejects forged fly-replay injection in instance", () => {
    expectBadRequest(() => assertReplayInstanceAllowed("x;app=other-app", allowed));
  });

  test("rejects instance containing equals sign", () => {
    expectBadRequest(() => assertReplayInstanceAllowed("instance=evil", allowed));
  });

  test("rejects unknown instance not in allowlist", () => {
    expectBadRequest(() => assertReplayInstanceAllowed("deadbeef", allowed));
  });

  test("allows instance present in allowlist", () => {
    expect(() => assertReplayInstanceAllowed("5ef6ddf5", allowed)).not.toThrow();
  });
});

describe("ensureAllowedInstance", () => {
  beforeEach(() => {
    vi.mocked(ensureInstance).mockReset();
  });

  test("valid instance still replays via ensureInstance", async () => {
    const replay = new Response(null, {
      status: 302,
      headers: { "fly-replay": "instance=abc12345" },
    });
    vi.mocked(ensureInstance).mockRejectedValueOnce(replay);

    await expect(ensureAllowedInstance("abc12345", allowed)).rejects.toBe(replay);
    expect(ensureInstance).toHaveBeenCalledOnce();
    expect(ensureInstance).toHaveBeenCalledWith("abc12345");
  });

  test("forged instance is rejected before ensureInstance runs", async () => {
    await expect(ensureAllowedInstance("x;app=other-app", allowed)).rejects.toBeInstanceOf(
      Response,
    );
    expect(ensureInstance).not.toHaveBeenCalled();
  });
});
