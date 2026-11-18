import { expect, test } from "vitest";
import { applyBulkQueueAction } from "./bulk-queue-action";

/** Mirrors the provider's Up Next semantics: play next front-inserts, others append. */
function fakeQueue(initial: string[] = []) {
  const upNext = [...initial];
  const spine: string[] = [];
  return {
    upNext,
    spine,
    handlers: {
      playNextTrack: (track: string) => {
        upNext.splice(0, 0, track);
      },
      addToUpNext: (track: string) => {
        upNext.push(track);
      },
      addToQueue: (track: string) => {
        spine.push(track);
      },
    },
  };
}

test("bulk play next lands the selection at the head of Up Next in selection order", () => {
  const queue = fakeQueue(["existing"]);
  applyBulkQueueAction(["a", "b", "c"], "playNext", queue.handlers);
  expect(queue.upNext).toEqual(["a", "b", "c", "existing"]);
});

test("bulk add to up next appends in selection order", () => {
  const queue = fakeQueue(["existing"]);
  applyBulkQueueAction(["a", "b"], "addToUpNext", queue.handlers);
  expect(queue.upNext).toEqual(["existing", "a", "b"]);
});

test("bulk add to queue appends to the spine in selection order", () => {
  const queue = fakeQueue();
  applyBulkQueueAction(["a", "b"], "addToQueue", queue.handlers);
  expect(queue.spine).toEqual(["a", "b"]);
});

test("bulk play next does not mutate the caller's selection", () => {
  const queue = fakeQueue();
  const selection = ["a", "b"];
  applyBulkQueueAction(selection, "playNext", queue.handlers);
  expect(selection).toEqual(["a", "b"]);
});
