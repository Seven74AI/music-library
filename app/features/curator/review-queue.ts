export const QUEUE_STATUS_MINE = "mine";

export const ISSUE_TYPE_LABELS: Record<string, string> = {
  wrong_metadata: "Wrong metadata",
  missing_info: "Missing info",
  low_quality: "Low quality",
  duplicate: "Duplicate",
  other: "Other",
};

export const QUEUE_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  claimed: "Claimed",
  resolved: "Resolved",
};

export const RESOLUTION_LABELS: Record<string, string> = {
  fixed: "Fixed",
  not_an_issue: "Not an issue",
  duplicate: "Duplicate",
  cannot_fix: "Cannot fix",
};

export function queueStatusLabel(status: string): string {
  return QUEUE_STATUS_LABELS[status] ?? status;
}

export function resolutionLabel(resolution: string): string {
  return RESOLUTION_LABELS[resolution] ?? resolution;
}

export function ensureSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function queueMatter(item: { issueType: string; description: string | null }): string {
  const description = item.description?.trim();
  if (description) return description;
  const label = ISSUE_TYPE_LABELS[item.issueType] ?? item.issueType;
  return `No extra detail was given. The report is marked as ${label}.`;
}

export function filedReportMessage(entityName: string, matter: string): string {
  return `${entityName}. Matter: ${ensureSentence(matter)} Find it under My reports.`;
}

export type QueueMove = {
  kind: "claim" | "unclaim" | "resolve";
  item: { issueType: string; description: string | null; entityDetails: { name: string } };
  resolution?: string;
  resolutionComment?: string;
};

export function queueActionFeedback(move: QueueMove): {
  status: string;
  title: string;
  description: string;
} {
  const name = move.item.entityDetails.name;
  const matter = ensureSentence(queueMatter(move.item));
  if (move.kind === "claim") {
    return {
      status: QUEUE_STATUS_MINE,
      title: "Claim saved",
      description: `${name}. Matter: ${matter} Find it under My claims.`,
    };
  }
  if (move.kind === "unclaim") {
    return {
      status: "open",
      title: "Claim released",
      description: `${name}. Matter: ${matter} It's back in the open list.`,
    };
  }
  const label = resolutionLabel(move.resolution ?? "resolved");
  const comment = ensureSentence(move.resolutionComment ?? "");
  return {
    status: "resolved",
    title: "Resolution saved",
    description: `${name}. ${label}: ${comment} Find it under Resolved.`,
  };
}

export function entityPath(entityType: string, entityId: string): string | null {
  if (entityType === "track") return `/library/${entityId}`;
  if (entityType === "artist") return `/artists/${entityId}`;
  if (entityType === "album") return `/albums/${entityId}`;
  return null;
}

export function entityTypeLabel(entityType: string): string {
  if (entityType === "track") return "Track";
  if (entityType === "artist") return "Artist";
  if (entityType === "album") return "Album";
  return entityType;
}

export type ReviewQueueListItem = {
  id: string;
  entityType: string;
  entityId: string;
  source: string;
  issueType: string;
  description: string | null;
  status: string;
  priority: number;
  claimedBy: string | null;
  resolution: string | null;
  resolutionComment: string | null;
  createdAt: string;
  entityDetails: { name: string };
  reporter: { id: string; username: string; name: string | null } | null;
  claimedByUser: { id: string; username: string; name: string | null } | null;
  resolvedByUser: { id: string; username: string; name: string | null } | null;
};
