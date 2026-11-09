import * as Sentry from "@sentry/react-router";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

const SENSITIVE_QUERY_PARAM_KEYS = ["code", "state", "target"];

function stripSensitiveUrlQueryParams(href) {
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

function shouldRedactSensitiveHeaderValue(value) {
  if (/\?[^#\s]*\bcode=/i.test(value)) return true;
  return SENSITIVE_QUERY_PARAM_KEYS.some((key) => new RegExp(`[?&#]${key}=`, "i").test(value));
}

function redactSensitiveSentryRequestHeaders(headers) {
  if (!headers) return headers;
  const next = { ...headers };
  for (const [key, value] of Object.entries(next)) {
    if (key.toLowerCase() === "referer" || shouldRedactSensitiveHeaderValue(value)) {
      next[key] = stripSensitiveUrlQueryParams(value);
    }
  }
  return next;
}

function scrubSensitiveSentryEvent(event) {
  if (event.request?.headers) {
    event.request.headers = redactSensitiveSentryRequestHeaders(event.request.headers);
  }
  if (event.request?.url) {
    event.request.url = stripSensitiveUrlQueryParams(event.request.url);
  }
  return event;
}

const environment = process.env.NODE_ENV ?? process.env.SENTRY_ENVIRONMENT ?? "development";
const isProduction = environment === "production";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment,
  // Attribute events to a specific deploy when available.
  release: process.env.SENTRY_RELEASE ?? process.env.COMMIT_SHA,
  integrations: [
    Sentry.captureConsoleIntegration({ levels: ["error"] }),
    nodeProfilingIntegration(),
  ],
  // Performance Monitoring — cap sampling in production to avoid burning Sentry
  // quota and adding profiling CPU overhead to every request.
  tracesSampleRate: isProduction ? 0.1 : 1.0,
  // Sentry 11 removed per-transaction profilesSampleRate. Session profiling
  // follows each trace instead.
  profileSessionSampleRate: isProduction ? 0.1 : 1.0,
  profileLifecycle: "trace",
  dataCollection: {
    urlQueryParams: { deny: ["code", "state", "target"] },
  },
  beforeSend: scrubSensitiveSentryEvent,
});
