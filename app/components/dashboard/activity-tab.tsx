import { useCallback, useState } from "react";
import { Button } from "#app/components/ui/button.tsx";
import { Input } from "#app/components/ui/input.tsx";
import { Label } from "#app/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#app/components/ui/select.tsx";
import { ActivityFeed, activityUrl } from "#app/components/dashboard/activity-feed.tsx";
import { curatorLabel, type ActivityResult } from "#app/features/curator/dashboard.ts";

export function ActivityTab({ initial }: { initial: ActivityResult }) {
  const [curatorId, setCuratorId] = useState("all");
  const [entityType, setEntityType] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(initial.totalPages);
  const handleLoaded = useCallback((result: ActivityResult) => {
    setTotalPages(result.totalPages);
  }, []);

  const query = {
    page,
    curatorId: curatorId === "all" ? undefined : curatorId,
    entityType: entityType === "all" ? undefined : entityType,
    from: from || undefined,
    to: to || undefined,
  };
  const url = activityUrl(query);
  const isDefaultQuery = page === 1 && curatorId === "all" && entityType === "all" && !from && !to;

  async function exportCsv() {
    const exportUrl = `${url}${url.includes("?") ? "&" : "?"}format=csv`;
    const response = await fetch(exportUrl);
    if (!response.ok) return;
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = "curator-activity.csv";
    link.click();
    URL.revokeObjectURL(objectUrl);
  }

  return (
    <section>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Activity</h2>
          <p className="text-sm text-muted-foreground">
            Edits, merges, and splits across the library.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void exportCsv()}>
          Export CSV
        </Button>
      </div>
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor="activity-curator">Curator</Label>
          <Select
            value={curatorId}
            onValueChange={(value) => {
              setCuratorId(value);
              setPage(1);
            }}
          >
            <SelectTrigger id="activity-curator">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All curators</SelectItem>
              {initial.curators.map((curator) => (
                <SelectItem key={curator.id} value={curator.id}>
                  {curatorLabel(curator)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="activity-entity">Entity type</Label>
          <Select
            value={entityType}
            onValueChange={(value) => {
              setEntityType(value);
              setPage(1);
            }}
          >
            <SelectTrigger id="activity-entity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="track">Tracks</SelectItem>
              <SelectItem value="artist">Artists</SelectItem>
              <SelectItem value="album">Albums</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="activity-from">From</Label>
          <Input
            id="activity-from"
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="activity-to">To</Label>
          <Input
            id="activity-to"
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>
      <ActivityFeed
        key={url}
        url={url}
        initial={isDefaultQuery ? initial : undefined}
        onLoaded={handleLoaded}
      />
      <div className="mt-6 flex items-center justify-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => setPage((value) => value - 1)}
        >
          Previous
        </Button>
        <span className="text-sm">
          Page {page} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => setPage((value) => value + 1)}
        >
          Next
        </Button>
      </div>
    </section>
  );
}
