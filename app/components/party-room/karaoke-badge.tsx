import { cn } from "#app/utils/misc.tsx";

/** Small pill shown next to a room code when the room is a karaoke room. */
export function KaraokeBadge({ className }: { className?: string }) {
  return (
    <span
      data-testid="karaoke-badge"
      className={cn(
        "inline-flex items-center rounded-full bg-fuchsia-600 px-2.5 py-0.5 text-xs font-semibold text-white",
        className,
      )}
    >
      Karaoke
    </span>
  );
}
