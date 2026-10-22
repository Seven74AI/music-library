/**
 * React Router Lazy Route Discovery throws this when a stale tab hits a new
 * deploy and the loop-guard already attempted a document reload (see fog-of-war).
 */
export const MANIFEST_MISMATCH_MESSAGE =
  "Unable to discover routes due to manifest version mismatch";

const RR_MANIFEST_VERSION_KEY = "react-router-manifest-version";
const APP_RECOVERY_KEY = "en-manifest-mismatch-recovery";

export function isManifestVersionMismatchError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes("manifest version mismatch");
}

/**
 * Clear RR's loop-guard and force one bounded hard reload so the user lands on
 * a fresh document with the current deploy's manifest. Returns true when a
 * reload was triggered (caller should render a brief "Updating…" state).
 */
export function tryRecoverFromManifestMismatch(
  error: unknown,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = sessionStorage,
  reload: () => void = () => {
    window.location.reload();
  },
): boolean {
  if (!isManifestVersionMismatchError(error)) return false;

  try {
    if (storage.getItem(APP_RECOVERY_KEY) === "1") {
      // Already tried once this session — surface the error UI instead of looping.
      storage.removeItem(APP_RECOVERY_KEY);
      return false;
    }
    storage.setItem(APP_RECOVERY_KEY, "1");
    storage.removeItem(RR_MANIFEST_VERSION_KEY);
  } catch {
    // Storage unavailable — still attempt a single reload.
  }

  reload();
  return true;
}
