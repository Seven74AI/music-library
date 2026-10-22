import { type WeeklyWrapSummary } from "#app/features/weekly-wrap/weekly-wrap.server.ts";

type WeeklyWrapProps = {
  wrap: WeeklyWrapSummary | null;
};

/**
 * Quiet home-only listening summary. Renders nothing when `wrap` is null
 * (zero finishes in the current UTC week).
 */
export function WeeklyWrap({ wrap }: WeeklyWrapProps) {
  if (!wrap) return null;

  const parts = [
    `${wrap.finishes} ${wrap.finishes === 1 ? "finish" : "finishes"}`,
    `${wrap.uniqueTracks} ${wrap.uniqueTracks === 1 ? "track" : "tracks"}`,
  ];
  if (wrap.dayStreak != null) {
    parts.push(`${wrap.dayStreak}-day streak`);
  }

  return (
    <p className="text-muted-foreground mb-8 text-center text-sm" data-testid="weekly-wrap">
      <span className="font-medium text-foreground">This week</span>
      <span aria-hidden="true"> · </span>
      {parts.join(" · ")}
    </p>
  );
}
