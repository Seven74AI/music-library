import { expect, test } from "vitest";
import {
  clearPersistedSchedulerStateForTests,
  loadPersistedSchedulerState,
  persistSchedulerState,
} from "./scheduler-state.server.ts";

test("persistSchedulerState round-trips through BackupState singleton", async () => {
  await clearPersistedSchedulerStateForTests();
  const nextRetryAt = Date.parse("2026-09-28T03:15:00.000Z");
  await persistSchedulerState({
    lastSuccessDay: "2026-09-27",
    attemptsToday: 2,
    attemptDay: "2026-09-28",
    nextRetryAt,
  });

  const loaded = await loadPersistedSchedulerState();
  expect(loaded).toEqual({
    lastSuccessDay: "2026-09-27",
    attemptsToday: 2,
    attemptDay: "2026-09-28",
    nextRetryAt,
  });
});
