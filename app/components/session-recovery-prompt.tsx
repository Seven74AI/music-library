import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "#app/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#app/components/ui/dialog.tsx";
import { saveSelectedTrackIds } from "#app/features/curator/selection.ts";
import {
  discardSession,
  formatSessionAge,
  hasRecoverableSession,
  oldestTimestamp,
  restoreSession,
  summarizeSession,
  type SessionState,
} from "#app/features/curator/session-recovery.client.ts";
import {
  publishRestoredDialogs,
  publishRestoredSession,
} from "#app/features/curator/session-restore.ts";

function applyRestoredSession(states: SessionState[], navigate: ReturnType<typeof useNavigate>) {
  publishRestoredSession(states);
  for (const state of states) {
    if (state.type === "selection" && state.trackIds.length > 0) {
      saveSelectedTrackIds(new Set(state.trackIds));
    }
    if (state.type === "dialogs") {
      publishRestoredDialogs(state.openDialogs);
    }
    if (state.type === "filters" && window.location.pathname === state.page) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(state.filters)) {
        if (value == null || value === false || value === "") continue;
        params.set(key, String(value));
      }
      const search = params.toString();
      navigate(search ? `${state.page}?${search}` : state.page, { replace: true });
      window.setTimeout(() => window.scrollTo(0, state.scrollPosition), 50);
    }
    if (
      state.type === "activeTab" &&
      state.dashboardTab &&
      window.location.pathname.startsWith("/music/curator/dashboard")
    ) {
      const params = new URLSearchParams(window.location.search);
      if (state.dashboardTab === "overview") params.delete("tab");
      else params.set("tab", state.dashboardTab);
      const search = params.toString();
      navigate(search ? `?${search}` : "?", { replace: true });
    }
  }
}

export function SessionRecoveryPrompt({
  onRestore,
  onDiscard,
}: {
  onRestore?: (states: SessionState[]) => void;
  onDiscard?: () => void;
} = {}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<string[]>([]);
  const [age, setAge] = useState("earlier");
  const statesRef = useRef<SessionState[]>([]);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const states = restoreSession();
    if (!hasRecoverableSession(states)) return;
    statesRef.current = states;
    setSummary(summarizeSession(states));
    const oldest = oldestTimestamp(states);
    setAge(oldest == null ? "earlier" : formatSessionAge(oldest));
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);

  const dismiss = () => setOpen(false);

  const discard = () => {
    discardSession();
    statesRef.current = [];
    onDiscard?.();
    dismiss();
  };

  const restore = () => {
    const states = statesRef.current;
    if (onRestore) onRestore(states);
    else applyRestoredSession(states, navigate);
    dismiss();
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : dismiss())}>
      <DialogContent
        className="max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto"
        data-testid="session-recovery-prompt"
        onCloseAutoFocus={(event) => {
          if (!returnFocus.current) return;
          event.preventDefault();
          returnFocus.current.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Restore previous session?</DialogTitle>
          <DialogDescription>
            You have unsaved curator work from {age}. Restore it, or discard it and start fresh.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 text-sm">
          {summary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            data-testid="session-recovery-discard"
            onClick={discard}
          >
            Discard
          </Button>
          <Button type="button" className="min-h-11" onClick={restore}>
            Restore
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
