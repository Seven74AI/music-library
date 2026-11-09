import {
  SENSITIVE_URL_QUERY_PARAMS,
  SENSITIVE_URL_SESSION_STORAGE_KEY,
} from "./sensitive-url-query-params.shared.ts";

export type StoredSensitiveUrlParams = Record<string, string>;

declare global {
  interface Window {
    __SENSITIVE_PARAMS__?: StoredSensitiveUrlParams;
  }
}

function searchHasSensitiveParam(searchParams: URLSearchParams): boolean {
  return SENSITIVE_URL_QUERY_PARAMS.some((key) => searchParams.has(key));
}

function readStoredParams(): StoredSensitiveUrlParams | null {
  if (typeof window === "undefined") {
    return null;
  }
  if (window.__SENSITIVE_PARAMS__ && Object.keys(window.__SENSITIVE_PARAMS__).length > 0) {
    return { ...window.__SENSITIVE_PARAMS__ };
  }
  try {
    const raw = sessionStorage.getItem(SENSITIVE_URL_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return { ...(parsed as StoredSensitiveUrlParams) };
  } catch {
    return null;
  }
}

/** Runs synchronously in the document head, before the app bundle and Sentry. */
export function runSensitiveUrlScrub(): void {
  if (typeof window === "undefined") {
    return;
  }
  const searchParams = new URLSearchParams(window.location.search);
  if (!searchHasSensitiveParam(searchParams)) {
    return;
  }

  const stored: StoredSensitiveUrlParams = {};
  searchParams.forEach((value, key) => {
    stored[key] = value;
  });

  window.__SENSITIVE_PARAMS__ = stored;
  try {
    sessionStorage.setItem(SENSITIVE_URL_SESSION_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // sessionStorage may be unavailable in private mode; in-memory is enough for this navigation.
  }

  window.history.replaceState(window.history.state, "", window.location.pathname);
}

export function getVerifySearchParam(name: string, searchParams: URLSearchParams): string | null {
  const stored = readStoredParams();
  if (stored && name in stored) {
    return stored[name] ?? null;
  }
  return searchParams.get(name);
}

export function buildSensitiveUrlScrubInlineScript(): string {
  const sensitiveKeysJson = JSON.stringify([...SENSITIVE_URL_QUERY_PARAMS]);
  const storageKey = JSON.stringify(SENSITIVE_URL_SESSION_STORAGE_KEY);
  return `(function(){try{var sensitive=${sensitiveKeysJson};var search=window.location.search;if(!search||search==="?")return;var params=new URLSearchParams(search);var hasSensitive=false;for(var i=0;i<sensitive.length;i++){if(params.has(sensitive[i])){hasSensitive=true;break;}}if(!hasSensitive)return;var stored={};params.forEach(function(v,k){stored[k]=v;});window.__SENSITIVE_PARAMS__=stored;try{sessionStorage.setItem(${storageKey},JSON.stringify(stored));}catch(e){}history.replaceState(history.state,"",window.location.pathname);}catch(e){}})();`;
}
