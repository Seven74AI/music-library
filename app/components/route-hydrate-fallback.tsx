export function RouteHydrateFallback() {
  return (
    <div
      className="flex min-h-[40vh] items-center justify-center py-12"
      aria-busy="true"
      aria-live="polite"
    >
      <p className="text-lg font-medium text-muted-foreground">Loading…</p>
    </div>
  );
}
