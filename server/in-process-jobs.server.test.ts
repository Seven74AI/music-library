import { describe, expect, it } from "vitest";
import { stopInProcessJobs } from "./in-process-jobs.server.ts";

describe("in-process-jobs shutdown", () => {
  it("stopInProcessJobs resolves after stopping every registered worker", async () => {
    await expect(stopInProcessJobs()).resolves.toBeUndefined();
  });
});
