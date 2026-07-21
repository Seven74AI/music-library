export function isOfflineEnvironment() {
  return typeof navigator !== "undefined" && !navigator.onLine;
}
