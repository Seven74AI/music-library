import { useEffect, useRef } from "react";
import {
  saveSessionState,
  SESSION_SAVE_DEBOUNCE_MS,
  type FilterState,
} from "./session-recovery.client.ts";
import { subscribeRestoredSession } from "./session-restore.ts";

export function useCuratorFilterSession({
  enabled = true,
  page,
  filters,
  active,
  readScroll,
  onRestore,
}: {
  enabled?: boolean;
  page: string;
  filters: FilterState["filters"];
  active: boolean;
  readScroll?: () => number;
  onRestore?: (state: FilterState) => void;
}) {
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const readScrollRef = useRef(readScroll);
  readScrollRef.current = readScroll;
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;
  const filtersKey = JSON.stringify(filters);

  useEffect(() => {
    if (!enabled || !active || typeof saveSessionState !== "function") return;
    const timer = window.setTimeout(() => {
      saveSessionState({
        type: "filters",
        page,
        filters: filtersRef.current,
        scrollPosition: readScrollRef.current?.() ?? 0,
        timestamp: Date.now(),
      });
    }, SESSION_SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [active, enabled, filtersKey, page]);

  useEffect(() => {
    return subscribeRestoredSession((states) => {
      const match = states.find((state) => state.type === "filters" && state.page === page);
      if (match?.type === "filters") onRestoreRef.current?.(match);
    });
  }, [page]);
}
