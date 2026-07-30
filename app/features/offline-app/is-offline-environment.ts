export function isOfflineEnvironment() {
  return (
    typeof navigator !== "undefined" && typeof navigator.onLine === "boolean" && !navigator.onLine
  );
}
