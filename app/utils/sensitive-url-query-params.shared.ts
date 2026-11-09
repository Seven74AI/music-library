export const SENSITIVE_URL_QUERY_PARAMS = ["code", "state", "target"] as const;

export const SENSITIVE_URL_SESSION_STORAGE_KEY = "__SENSITIVE_PARAMS__";

export function stripSensitiveUrlQueryParams(href: string): string {
  try {
    const parsed = new URL(href, "http://localhost");
    for (const key of SENSITIVE_URL_QUERY_PARAMS) {
      parsed.searchParams.delete(key);
    }
    if (parsed.hash.includes("?")) {
      const [hashPath, hashQuery = ""] = parsed.hash.slice(1).split("?", 2);
      const hashParams = new URLSearchParams(hashQuery);
      for (const key of SENSITIVE_URL_QUERY_PARAMS) {
        hashParams.delete(key);
      }
      const nextHashQuery = hashParams.toString();
      parsed.hash = nextHashQuery
        ? `#${hashPath}?${nextHashQuery}`
        : hashPath
          ? `#${hashPath}`
          : "";
    } else if (parsed.hash) {
      const hashBody = parsed.hash.slice(1);
      const hashParams = new URLSearchParams(hashBody);
      const stripped = SENSITIVE_URL_QUERY_PARAMS.some((key) => hashParams.has(key));
      if (stripped) {
        for (const key of SENSITIVE_URL_QUERY_PARAMS) {
          hashParams.delete(key);
        }
        const next = hashParams.toString();
        parsed.hash = next ? `#${next}` : "";
      }
    }
    if (/^https?:\/\//i.test(href)) {
      return parsed.toString();
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    const queryStart = href.indexOf("?");
    const hashStart = href.indexOf("#");
    let end = href.length;
    if (queryStart >= 0) end = Math.min(end, queryStart);
    if (hashStart >= 0) end = Math.min(end, hashStart);
    return href.slice(0, end);
  }
}

/** Inline script for document `<head>` — must live outside `.client` modules for SSR. */
export function buildSensitiveUrlScrubInlineScript(): string {
  const sensitiveKeysJson = JSON.stringify([...SENSITIVE_URL_QUERY_PARAMS]);
  const storageKey = JSON.stringify(SENSITIVE_URL_SESSION_STORAGE_KEY);
  return `(function(){try{var sensitive=${sensitiveKeysJson};var search=window.location.search;if(!search||search==="?")return;var params=new URLSearchParams(search);var hasSensitive=false;for(var i=0;i<sensitive.length;i++){if(params.has(sensitive[i])){hasSensitive=true;break;}}if(!hasSensitive)return;var stored={};params.forEach(function(v,k){stored[k]=v;});window.__SENSITIVE_PARAMS__=stored;try{sessionStorage.setItem(${storageKey},JSON.stringify(stored));}catch(e){}history.replaceState(history.state,"",window.location.pathname);}catch(e){}})();`;
}
