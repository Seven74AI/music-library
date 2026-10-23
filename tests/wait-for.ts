/**
 * Poll a callback until it returns a non-nullish value or throws.
 *
 * Polls every 100ms. Returns the first non-nullish result (`!== undefined`
 * and `!== null`) — including legitimate falsy values like `0`, `""`, or
 * `false`, which must NOT trigger further polling. On timeout, throws the
 * last error the callback threw, or `errorMessage` if provided, or the
 * `"waitFor timed out"` fallback.
 */
export async function waitFor<ReturnValue>(
  cb: () => ReturnValue | Promise<ReturnValue>,
  { errorMessage, timeout = 5000 }: { errorMessage?: string; timeout?: number } = {},
) {
  const endTime = Date.now() + timeout;
  let lastError: unknown;
  while (Date.now() < endTime) {
    try {
      const response = await cb();
      if (response !== undefined && response !== null) return response;
    } catch (e: unknown) {
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw lastError ?? new Error(errorMessage ?? "waitFor timed out");
}
