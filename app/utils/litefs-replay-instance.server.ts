import { invariantResponse } from "@epic-web/invariant";
import { ensureInstance } from "litefs-js/remix";

/** Characters Fly parses as fly-replay field separators or assignment. */
const FORBIDDEN_REPLAY_INSTANCE = /[;=\r\n]/;

/** Fly machine / VM ids from DNS (allowlist keys in production). */
const FLY_MACHINE_ID_RE = /^[a-zA-Z0-9_-]+$/;

type AllowedInstances = Record<string, string | string[]>;

export function assertReplayInstanceAllowed(
  instance: string,
  allowedInstances: AllowedInstances,
): void {
  invariantResponse(typeof instance === "string" && instance.length > 0, "Invalid instance", {
    status: 400,
  });
  invariantResponse(!FORBIDDEN_REPLAY_INSTANCE.test(instance), "Invalid instance", {
    status: 400,
  });
  invariantResponse(Object.hasOwn(allowedInstances, instance), "Unknown instance", {
    status: 400,
  });
  if (process.env.FLY_APP_NAME) {
    invariantResponse(FLY_MACHINE_ID_RE.test(instance), "Invalid instance", {
      status: 400,
    });
  }
}

export async function ensureAllowedInstance(
  instance: string,
  allowedInstances: AllowedInstances,
): Promise<true> {
  assertReplayInstanceAllowed(instance, allowedInstances);
  return ensureInstance(instance);
}
