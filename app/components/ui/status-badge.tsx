import { Badge } from "./badge";

export const DEFAULT_STATUS_LABELS = {
  pending: "Pending",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
  running: "Running",
  paused: "Paused",
  long_break: "Long Break",
} as const;

/**
 * Known status values: ArchiveJob.status ("pending" | "processing" |
 * "completed" | "failed") plus WorkerState.status ("running" | "paused" |
 * "long_break"). Keeping this a closed union prevents callers from passing
 * arbitrary strings that silently fall back to a generic label.
 */
export type StatusBadgeStatus = keyof typeof DEFAULT_STATUS_LABELS;

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

const DEFAULT_STATUS_VARIANTS: Record<StatusBadgeStatus, BadgeVariant> = {
  pending: "secondary",
  processing: "default",
  completed: "default",
  failed: "destructive",
  running: "default",
  paused: "secondary",
  long_break: "outline",
};

interface StatusBadgeProps {
  status: StatusBadgeStatus;
  variant?: BadgeVariant;
  labels?: Partial<Record<StatusBadgeStatus, string>>;
}

export function StatusBadge({ status, variant, labels = DEFAULT_STATUS_LABELS }: StatusBadgeProps) {
  const statusVariant = variant ?? DEFAULT_STATUS_VARIANTS[status] ?? "secondary";
  const statusLabel = labels[status] ?? status.charAt(0).toUpperCase() + status.slice(1);

  return <Badge variant={statusVariant}>{statusLabel}</Badge>;
}
