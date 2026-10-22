import { useEffect, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";
import { Badge } from "#app/components/ui/badge.tsx";
import { Button } from "#app/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "#app/components/ui/card.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#app/components/ui/dialog.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { Label } from "#app/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#app/components/ui/select.tsx";
import { Textarea } from "#app/components/ui/textarea.tsx";
import { toast } from "#app/components/ui/use-toast.ts";
import {
  entityPath,
  entityTypeLabel,
  QUEUE_STATUS_MINE,
  queueActionFeedback,
  queueMatter,
  queueStatusLabel,
  resolutionLabel,
  type QueueMove,
  type ReviewQueueListItem,
} from "#app/features/curator/review-queue.ts";
import { useCuratorFilterSession } from "#app/features/curator/use-curator-session.ts";

type QueueResponse = {
  items: ReviewQueueListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  currentUserId: string;
};

type QueueActionResult = {
  success?: boolean;
  error?: string;
};

const ISSUE_TYPE_LABELS: Record<string, string> = {
  wrong_metadata: "Wrong metadata",
  missing_info: "Missing info",
  low_quality: "Low quality",
  duplicate: "Duplicate",
  other: "Other",
};

const SOURCE_LABELS: Record<string, string> = {
  user_report: "User report",
  system: "System detection",
  curator: "Curator flag",
};

const RESOLUTION_OPTIONS = [
  { value: "fixed", label: "Fixed" },
  { value: "not_an_issue", label: "Not an issue" },
  { value: "duplicate", label: "Duplicate" },
  { value: "cannot_fix", label: "Cannot fix" },
];

function QueueItemHeading({ item }: { item: ReviewQueueListItem }) {
  const href = entityPath(item.entityType, item.entityId);
  return (
    <>
      <h3 className="mb-1 text-lg font-semibold">
        {href ? (
          <Link to={href} className="hover:underline">
            {item.entityDetails.name}
          </Link>
        ) : (
          item.entityDetails.name
        )}
      </h3>
      <p className="mb-2 text-xs text-muted-foreground">{entityTypeLabel(item.entityType)}</p>
    </>
  );
}

function queueUrl(filters: { status: string; entityType: string; source: string; page: number }) {
  const params = new URLSearchParams();
  params.set("status", filters.status);
  if (filters.entityType !== "all") params.set("entityType", filters.entityType);
  if (filters.source !== "all") params.set("source", filters.source);
  params.set("page", String(filters.page));
  return `/api/curator/queue?${params.toString()}`;
}

export function QueueTable() {
  const queueFetcher = useFetcher<QueueResponse>();
  const actionFetcher = useFetcher<QueueActionResult>();
  const [status, setStatus] = useState("open");
  const [entityType, setEntityType] = useState("all");
  const [source, setSource] = useState("all");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ReviewQueueListItem | null>(null);
  const [resolution, setResolution] = useState("");
  const [resolutionComment, setResolutionComment] = useState("");

  const url = queueUrl({ status, entityType, source, page });
  useCuratorFilterSession({
    page: "/music/curator/queue",
    filters: { status, entityType, source, page: String(page) },
    active: status !== "open" || entityType !== "all" || source !== "all" || page !== 1,
    readScroll: () => window.scrollY,
    onRestore: (state) => {
      const nextStatus = state.filters.status;
      const nextEntity = state.filters.entityType;
      const nextSource = state.filters.source;
      const nextPage = state.filters.page;
      if (typeof nextStatus === "string") setStatus(nextStatus);
      if (typeof nextEntity === "string") setEntityType(nextEntity);
      if (typeof nextSource === "string") setSource(nextSource);
      if (typeof nextPage === "string") setPage(Number(nextPage) || 1);
      window.setTimeout(() => window.scrollTo(0, state.scrollPosition), 50);
    },
  });

  useEffect(() => {
    void queueFetcher.load(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, reloadKey]);

  const lastAction = useRef<unknown>(null);
  const pendingMove = useRef<QueueMove | null>(null);
  useEffect(() => {
    if (actionFetcher.state !== "idle" || actionFetcher.data == null) return;
    if (lastAction.current === actionFetcher.data) return;
    lastAction.current = actionFetcher.data;
    const move = pendingMove.current;
    pendingMove.current = null;
    if (actionFetcher.data.success && move) {
      const feedback = queueActionFeedback(move);
      setStatus(feedback.status);
      setEntityType("all");
      setSource("all");
      setPage(1);
      toast({ title: feedback.title, description: feedback.description });
    } else if (actionFetcher.data.success === false) {
      toast({
        title: "Could not update the queue",
        description: actionFetcher.data.error ?? "Try again.",
        variant: "destructive",
      });
    }
    setReloadKey((value) => value + 1);
  }, [actionFetcher.state, actionFetcher.data]);

  const items = queueFetcher.data?.items ?? [];
  const totalPages = queueFetcher.data?.totalPages ?? 1;
  const currentUserId = queueFetcher.data?.currentUserId;
  const isLoading = queueFetcher.state !== "idle" && !queueFetcher.data;

  const submitAction = (action: string, formData?: FormData) => {
    void actionFetcher.submit(formData ?? new FormData(), { method: "POST", action });
  };

  return (
    <div data-testid="queue-table">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Open reports stay in the shared pool. Claim one and it stays under My claims. Unclaim puts
          it back on Open. Resolve keeps it under Resolved, with the decision written on the card.
        </p>
        <Button
          type="button"
          variant={status === QUEUE_STATUS_MINE ? "default" : "outline"}
          onClick={() => {
            setStatus(QUEUE_STATUS_MINE);
            setPage(1);
          }}
        >
          My claims
        </Button>
      </div>
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="queue-status">Status</Label>
              <Select
                value={status}
                onValueChange={(value) => {
                  setStatus(value);
                  setPage(1);
                }}
              >
                <SelectTrigger id="queue-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value={QUEUE_STATUS_MINE}>My claims</SelectItem>
                  <SelectItem value="claimed">Claimed by anyone</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="queue-entity">Entity type</Label>
              <Select
                value={entityType}
                onValueChange={(value) => {
                  setEntityType(value);
                  setPage(1);
                }}
              >
                <SelectTrigger id="queue-entity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="track">Track</SelectItem>
                  <SelectItem value="artist">Artist</SelectItem>
                  <SelectItem value="album">Album</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="queue-source">Source</Label>
              <Select
                value={source}
                onValueChange={(value) => {
                  setSource(value);
                  setPage(1);
                }}
              >
                <SelectTrigger id="queue-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sources</SelectItem>
                  <SelectItem value="user_report">User report</SelectItem>
                  <SelectItem value="system">System detection</SelectItem>
                  <SelectItem value="curator">Curator flag</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Icon name="update" className="h-8 w-8 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No items found matching the current filters.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <Card key={item.id}>
              <CardContent className="py-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge
                        variant={
                          item.priority === 3
                            ? "destructive"
                            : item.priority === 2
                              ? "default"
                              : "secondary"
                        }
                      >
                        {item.priority === 3 ? "High" : item.priority === 2 ? "Medium" : "Low"}
                      </Badge>
                      <Badge variant={item.status === "claimed" ? "default" : "outline"}>
                        {queueStatusLabel(item.status)}
                      </Badge>
                      <Badge variant="outline">{SOURCE_LABELS[item.source] ?? item.source}</Badge>
                      <Badge variant="outline">
                        {ISSUE_TYPE_LABELS[item.issueType] ?? item.issueType}
                      </Badge>
                    </div>
                    <QueueItemHeading item={item} />
                    <p className="mb-2 text-sm">
                      <span className="font-medium">Matter</span>{" "}
                      <span className="text-muted-foreground">{queueMatter(item)}</span>
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      {item.reporter ? (
                        <span>Reported by {item.reporter.name || item.reporter.username}</span>
                      ) : null}
                      {item.claimedByUser ? (
                        <span>
                          Claimed by {item.claimedByUser.name || item.claimedByUser.username}
                        </span>
                      ) : null}
                      {item.resolvedByUser ? (
                        <span>
                          Resolved by {item.resolvedByUser.name || item.resolvedByUser.username}
                        </span>
                      ) : null}
                      <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                    </div>
                    {item.resolution ? (
                      <div className="mt-2 rounded bg-muted p-2 text-sm">
                        <strong>Resolution:</strong> {resolutionLabel(item.resolution)}
                        {item.resolutionComment ? (
                          <p className="mt-1">{item.resolutionComment}</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    {item.status === "open" ? (
                      <Button
                        size="sm"
                        onClick={() => {
                          pendingMove.current = { kind: "claim", item };
                          submitAction(`/api/curator/queue/${item.id}/claim`);
                        }}
                      >
                        Claim
                      </Button>
                    ) : null}
                    {item.status === "claimed" && item.claimedBy === currentUserId ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            pendingMove.current = { kind: "unclaim", item };
                            submitAction(`/api/curator/queue/${item.id}/unclaim`);
                          }}
                        >
                          Unclaim
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            setSelectedItem(item);
                            setResolution("");
                            setResolutionComment("");
                            setResolveDialogOpen(true);
                          }}
                        >
                          Resolve
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((value) => value - 1)}
            disabled={page <= 1}
          >
            <Icon name="arrow-left" />
            Previous
          </Button>
          <span className="text-sm">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((value) => value + 1)}
            disabled={page >= totalPages}
          >
            Next
            <Icon name="arrow-right" />
          </Button>
        </div>
      ) : null}

      <Dialog open={resolveDialogOpen} onOpenChange={setResolveDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Resolve queue item</DialogTitle>
            <DialogDescription>Choose a resolution and explain the decision.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="resolution">Resolution</Label>
              <Select value={resolution} onValueChange={setResolution}>
                <SelectTrigger id="resolution">
                  <SelectValue placeholder="Select resolution" />
                </SelectTrigger>
                {/* DialogContent is z-53. The shared select menu is z-50 and renders under it. */}
                <SelectContent className="z-[70]">
                  {RESOLUTION_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="resolution-comment">Comment</Label>
              <Textarea
                id="resolution-comment"
                value={resolutionComment}
                onChange={(event) => setResolutionComment(event.target.value)}
                placeholder="Explain your resolution..."
                rows={4}
                maxLength={1000}
                className="resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setResolveDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!selectedItem || !resolution || !resolutionComment.trim()}
              onClick={() => {
                if (!selectedItem) return;
                pendingMove.current = {
                  kind: "resolve",
                  item: selectedItem,
                  resolution,
                  resolutionComment,
                };
                const formData = new FormData();
                formData.set("resolution", resolution);
                formData.set("resolutionComment", resolutionComment);
                submitAction(`/api/curator/queue/${selectedItem.id}/resolve`, formData);
                setResolveDialogOpen(false);
              }}
            >
              Resolve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
