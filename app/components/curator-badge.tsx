import { type CuratorBadgeSummary } from "#app/features/curator/badges.ts";

export function CuratorBadges({ badges }: { badges?: CuratorBadgeSummary[] }) {
  if (!badges || badges.length === 0) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1" aria-label="Curator badges">
      {badges.map((badge) => (
        <span
          key={badge.type}
          title={badge.label}
          className="inline-flex min-h-6 items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
        >
          {badge.label}
        </span>
      ))}
    </span>
  );
}
