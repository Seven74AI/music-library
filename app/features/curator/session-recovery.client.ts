/**
 * Curator session recovery (ADR-036).
 *
 * Workflow state is stored in origin-scoped localStorage under separate keys
 * so each piece can expire on its own. Nothing here is synced to the server.
 */

export const SESSION_KEYS = {
  selection: "curator-session-selection",
  dialogs: "curator-session-dialogs",
  filters: "curator-session-filters",
  activeTab: "curator-session-tabs",
} as const;

export const SELECTION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const FILTERS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const TABS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const DIALOGS_MAX_AGE_MS = 2 * 60 * 60 * 1000;
export const SESSION_SAVE_DEBOUNCE_MS = 1000;

const MAX_AGE_MS = {
  selection: SELECTION_MAX_AGE_MS,
  dialogs: DIALOGS_MAX_AGE_MS,
  filters: FILTERS_MAX_AGE_MS,
  activeTab: TABS_MAX_AGE_MS,
} as const;

export type SessionKeyName = keyof typeof SESSION_KEYS;

export type SelectionState = {
  type: "selection";
  trackIds: string[];
  context: "library" | "playlist";
  contextId?: string;
  timestamp: number;
};

export type DialogDraft = {
  dialogType: "track-edit" | "merge-preview" | "bulk-edit";
  entityId?: string;
  entityType?: string;
  sourceId?: string;
  targetId?: string;
  tab?: string;
  unsavedChanges?: Record<string, unknown>;
};

export type DialogState = {
  type: "dialogs";
  openDialogs: DialogDraft[];
  timestamp: number;
};

export type FilterState = {
  type: "filters";
  page: string;
  filters: Record<string, string | number | boolean | null>;
  scrollPosition: number;
  timestamp: number;
};

export type TabState = {
  type: "activeTab";
  dashboardTab?: string;
  queueTab?: string;
  timestamp: number;
};

export type SessionState = SelectionState | DialogState | FilterState | TabState;

export type KeyValueStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function isExpired(timestamp: number, maxAge: number, now = Date.now()): boolean {
  if (!Number.isFinite(timestamp) || !Number.isFinite(maxAge)) return true;
  return now - timestamp > maxAge;
}

export function maxAgeFor(type: SessionState["type"]): number {
  return MAX_AGE_MS[type];
}

function browserStorage(): KeyValueStorage | null {
  try {
    if (typeof globalThis.localStorage === "undefined") return null;
    if (typeof globalThis.localStorage.getItem !== "function") return null;
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function storageOrBrowser(storage?: KeyValueStorage | null): KeyValueStorage | null {
  return storage === undefined ? browserStorage() : storage;
}

export function saveSessionState(state: SessionState, storage?: KeyValueStorage | null): boolean {
  const target = storageOrBrowser(storage);
  if (!target) return false;
  const key = SESSION_KEYS[state.type];
  try {
    target.setItem(key, JSON.stringify(state));
    return true;
  } catch (error) {
    console.error("Failed to save session state:", error);
    return false;
  }
}

export function clearSessionState(
  type: SessionState["type"],
  storage?: KeyValueStorage | null,
): void {
  const target = storageOrBrowser(storage);
  if (!target) return;
  try {
    target.removeItem(SESSION_KEYS[type]);
  } catch (error) {
    console.error("Failed to clear session state:", error);
  }
}

function parseState(raw: string): SessionState | null {
  try {
    const parsed = JSON.parse(raw) as SessionState;
    if (!parsed || typeof parsed !== "object" || typeof parsed.type !== "string") return null;
    if (!(parsed.type in SESSION_KEYS)) return null;
    if (typeof parsed.timestamp !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function loadSession(storage?: KeyValueStorage | null, now = Date.now()): SessionState[] {
  const target = storageOrBrowser(storage);
  if (!target) return [];
  const states: SessionState[] = [];
  for (const type of Object.keys(SESSION_KEYS) as SessionKeyName[]) {
    const key = SESSION_KEYS[type];
    let raw: string | null = null;
    try {
      raw = target.getItem(key);
    } catch (error) {
      console.error("Failed to load session state:", error);
      continue;
    }
    if (!raw) continue;
    const parsed = parseState(raw);
    if (
      !parsed ||
      parsed.type !== type ||
      isExpired(parsed.timestamp, maxAgeFor(parsed.type), now)
    ) {
      try {
        target.removeItem(key);
      } catch (error) {
        console.error("Failed to clear session state:", error);
      }
      continue;
    }
    states.push(parsed);
  }
  return states;
}

export function discardSession(storage?: KeyValueStorage | null): void {
  for (const type of Object.keys(SESSION_KEYS) as SessionKeyName[]) {
    clearSessionState(type, storage);
  }
}

/** Return the non-expired snapshot the prompt can apply. Storage is left intact. */
export function restoreSession(storage?: KeyValueStorage | null, now = Date.now()): SessionState[] {
  return loadSession(storage, now);
}

/**
 * The dashboard tab is saved when the curator changes it.
 * The first paint must not write the tab back: Discard and Clear saved session
 * would otherwise be undone by the page that is already open.
 */
export function dashboardTabToPersist(previous: string | null, next: string): string | null {
  if (previous == null || previous === next || next === "overview") return null;
  return next;
}

export function oldestTimestamp(states: SessionState[]): number | null {
  if (states.length === 0) return null;
  return states.reduce((oldest, state) => Math.min(oldest, state.timestamp), states[0]!.timestamp);
}

export function formatSessionAge(timestamp: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - timestamp) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function summarizeSession(states: SessionState[]): string[] {
  const lines: string[] = [];
  for (const state of states) {
    if (state.type === "selection" && state.trackIds.length > 0) {
      const count = state.trackIds.length;
      lines.push(`${count} track${count === 1 ? "" : "s"} selected`);
    }
    if (state.type === "dialogs" && state.openDialogs.length > 0) {
      const count = state.openDialogs.length;
      const unsaved = state.openDialogs.some(
        (dialog) => dialog.unsavedChanges && Object.keys(dialog.unsavedChanges).length > 0,
      );
      lines.push(
        unsaved
          ? `${count} dialog${count === 1 ? "" : "s"} open with unsaved changes`
          : `${count} dialog${count === 1 ? "" : "s"} open`,
      );
    }
    if (state.type === "filters") {
      if (state.page === "/music/curator/queue" && state.filters.source === "user_report") {
        lines.push("Review queue filtered to user reports");
      } else if (Object.keys(state.filters).length > 0 || state.scrollPosition > 0) {
        lines.push(`Saved filters on ${state.page}`);
      }
      if (state.scrollPosition > 0) {
        lines.push(`Scroll position ${Math.round(state.scrollPosition)}px`);
      }
    }
    if (state.type === "activeTab") {
      if (state.dashboardTab && state.dashboardTab !== "overview") {
        lines.push(`Dashboard tab: ${state.dashboardTab}`);
      }
      if (state.queueTab) lines.push(`Review queue tab: ${state.queueTab}`);
    }
  }
  return lines;
}

export function hasRecoverableSession(states: SessionState[]): boolean {
  return summarizeSession(states).length > 0;
}

export function createDebouncedSessionSaver(
  waitMs = SESSION_SAVE_DEBOUNCE_MS,
  storage?: KeyValueStorage | null,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: SessionState | null = null;

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const next = pending;
    pending = null;
    if (next) saveSessionState(next, storage);
  };

  const save = (state: SessionState) => {
    pending = state;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, waitMs);
  };

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };

  return { save, flush, cancel };
}
