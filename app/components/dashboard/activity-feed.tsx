import { useEffect, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";
import { CuratorBadges } from "#app/components/curator-badge.tsx";
import {
  activityVerb,
  curatorLabel,
  formatRelativeTime,
  type ActivityResult,
} from "#app/features/curator/dashboard.ts";
import { entityPath } from "#app/features/curator/review-queue.ts";

const POLL_MS = 30_000;

export function activityUrl(query: {
  page?: number;
  curatorId?: string;
  entityType?: string;
  from?: string;
  to?: string;
}) {
  const params = new URLSearchParams();
  params.set("page", String(query.page ?? 1));
  if (query.curatorId) params.set("curatorId", query.curatorId);
  if (query.entityType) params.set("entityType", query.entityType);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  return `/api/curator/activity?${params.toString()}`;
}

export function ActivityFeed({
  url,
  initial,
  poll = true,
  compact = false,
  onLoaded,
  reloadToken = 0,
}: {
  url: string;
  initial?: ActivityResult;
  poll?: boolean;
  compact?: boolean;
  onLoaded?: (result: ActivityResult) => void;
  reloadToken?: number;
}) {
  const fetcher = useFetcher<ActivityResult>();
  const [now, setNow] = useState(() => new Date());
  const data = fetcher.data ?? initial;
  const skipInitialLoad = useRef(Boolean(initial));

  useEffect(() => {
    if (skipInitialLoad.current) {
      skipInitialLoad.current = false;
      return;
    }
    void fetcher.load(url);
    // fetcher identity changes after each load; depend on the URL only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    if (data) onLoaded?.(data);
  }, [data, onLoaded]);

  useEffect(() => {
    if (!reloadToken) return;
    void fetcher.load(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken, url]);

  useEffect(() => {
    if (!poll) return;
    const id = window.setInterval(() => {
      setNow(new Date());
      void fetcher.load(url);
    }, POLL_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, poll]);

  if (!data) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="activity-feed">
        Loading activity…
      </p>
    );
  }

  if (data.items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="activity-feed">
        No curator activity matches these filters.
      </p>
    );
  }

  const items = compact ? data.items.slice(0, 20) : data.items;

  return (
    <ul className="space-y-3" data-testid="activity-feed">
      {items.map((item) => {
        const href = entityPath(item.entityType, item.entityId);
        return (
          <li key={item.id} className="min-w-0 text-sm">
            <p className="break-words">
              {curatorLabel(item.curator)} {activityVerb(item.action)}{" "}
              {href ? (
                <Link to={href} className="font-medium hover:underline">
                  {item.entityName}
                </Link>
              ) : (
                item.entityName
              )}{" "}
              ({formatRelativeTime(new Date(item.createdAt), now)})
            </p>
            {item.matter ? <p className="text-muted-foreground">{item.matter}</p> : null}
            <CuratorBadges badges={item.badges} />
            <p className="text-xs text-muted-foreground capitalize">{item.entityType}</p>
          </li>
        );
      })}
    </ul>
  );
}
