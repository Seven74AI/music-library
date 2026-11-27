/**
 * Runs async tasks strictly one after another, in submission order.
 * A failing task rejects its own promise but never blocks later tasks.
 */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task, task);
    tail = result.catch(() => undefined);
    return result;
  };
}
