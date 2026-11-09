import type { ReplayFrameEvent } from "@sentry/replay";
import * as Sentry from "@sentry/react-router";

export const SENSITIVE_URL_QUERY_PARAMS = ["code", "state", "target"] as const;

export const SENTRY_SENSITIVE_DATA_COLLECTION = {
  urlQueryParams: { deny: [...SENSITIVE_URL_QUERY_PARAMS] as string[] },
};

export function stripSensitiveUrlQueryParams(href: string): string {
  try {
    const parsed = new URL(href, "http://localhost");
    for (const key of SENSITIVE_URL_QUERY_PARAMS) {
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

export function scrubReplayRecordingEvent(event: ReplayFrameEvent): ReplayFrameEvent {
  if (!event?.data || event.data.tag !== "breadcrumb") {
    return event;
  }
  const payload = event.data.payload;
  if (!payload || typeof payload !== "object" || !("data" in payload)) {
    return event;
  }
  const frameData = payload.data;
  if (!frameData || typeof frameData !== "object") {
    return event;
  }

  const nextFrameData = { ...frameData } as Record<string, unknown>;
  let changed = false;
  for (const key of ["url", "route"] as const) {
    const value = nextFrameData[key];
    if (typeof value === "string" && value.includes("?")) {
      nextFrameData[key] = stripSensitiveUrlQueryParams(value);
      changed = true;
    }
  }
  if (!changed) return event;

  return {
    ...event,
    data: {
      ...event.data,
      payload: { ...payload, data: nextFrameData },
    },
  };
}

export function buildProductionSentryInitOptions(dsn: string) {
  return {
    dsn,
    integrations: [
      Sentry.captureConsoleIntegration({ levels: ["error"] }),
      Sentry.reactRouterTracingIntegration(),
      Sentry.replayIntegration({
        maskAllInputs: true,
        beforeAddRecordingEvent: scrubReplayRecordingEvent,
      }),
      Sentry.feedbackIntegration({ colorScheme: "system" }),
    ],
    tracesSampleRate: 1.0,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    dataCollection: SENTRY_SENSITIVE_DATA_COLLECTION,
  };
}
