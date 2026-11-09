const SENSITIVE_QUERY_PARAM_KEYS = ["code", "state", "target"];

export function stripSensitiveUrlQueryParams(href) {
  try {
    const parsed = new URL(href, "http://localhost");
    for (const key of SENSITIVE_QUERY_PARAM_KEYS) {
      parsed.searchParams.delete(key);
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

export function shouldRedactSensitiveHeaderValue(value) {
  if (/\?[^#\s]*\bcode=/i.test(value)) return true;
  return SENSITIVE_QUERY_PARAM_KEYS.some((key) => new RegExp(`[?&#]${key}=`, "i").test(value));
}

export function redactSensitiveSentryRequestHeaders(headers) {
  if (!headers) return headers;
  const next = { ...headers };
  for (const [key, value] of Object.entries(next)) {
    if (key.toLowerCase() === "referer" || shouldRedactSensitiveHeaderValue(value)) {
      next[key] = stripSensitiveUrlQueryParams(value);
    }
  }
  return next;
}

function isRefererSpanAttributeKey(key) {
  const keyLower = key.toLowerCase();
  return (
    keyLower.endsWith(".referer") ||
    keyLower.endsWith(".referrer") ||
    keyLower === "request.headers.referer" ||
    keyLower === "headers.referer"
  );
}

function scrubSpanDataValue(key, value) {
  const refererKey = isRefererSpanAttributeKey(key);

  if (typeof value === "string") {
    if (refererKey || shouldRedactSensitiveHeaderValue(value)) {
      return stripSensitiveUrlQueryParams(value);
    }
    return value;
  }

  if (Array.isArray(value)) {
    if (
      refererKey ||
      value.some((entry) => typeof entry === "string" && shouldRedactSensitiveHeaderValue(entry))
    ) {
      return value.map((entry) =>
        typeof entry === "string" && (refererKey || shouldRedactSensitiveHeaderValue(entry))
          ? stripSensitiveUrlQueryParams(entry)
          : entry,
      );
    }
    return value;
  }

  if (value && typeof value === "object") {
    const keyLower = key.toLowerCase();
    if (keyLower === "request.headers" || keyLower === "headers") {
      return redactSensitiveSentryRequestHeaders(value);
    }
  }

  return value;
}

function scrubSensitiveSentrySpanData(data) {
  if (!data || typeof data !== "object") return data;
  const next = { ...data };
  for (const [key, value] of Object.entries(next)) {
    next[key] = scrubSpanDataValue(key, value);
  }
  return next;
}

export function scrubSensitiveSentryEvent(event) {
  if (event.request?.headers) {
    event.request.headers = redactSensitiveSentryRequestHeaders(event.request.headers);
  }
  if (event.request?.url) {
    event.request.url = stripSensitiveUrlQueryParams(event.request.url);
  }
  return event;
}

export function scrubSensitiveSentryTransaction(event) {
  scrubSensitiveSentryEvent(event);
  if (Array.isArray(event.spans)) {
    for (const span of event.spans) {
      if (span?.data) {
        span.data = scrubSensitiveSentrySpanData(span.data);
      }
    }
  }
  return event;
}
