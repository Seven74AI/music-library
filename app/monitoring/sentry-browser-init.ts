import type { Client, ErrorEvent, Event, Integration, ReplayEvent } from "@sentry/core";
import type { ReplayFrameEvent } from "@sentry/replay";
import * as Sentry from "@sentry/react-router";
import {
  SENSITIVE_URL_QUERY_PARAMS,
  stripSensitiveUrlQueryParams,
} from "#app/utils/sensitive-url-query-params.shared.ts";

export { SENSITIVE_URL_QUERY_PARAMS, stripSensitiveUrlQueryParams };

export const SENTRY_SENSITIVE_DATA_COLLECTION = {
  urlQueryParams: { deny: [...SENSITIVE_URL_QUERY_PARAMS] as string[] },
};

const RRWEB_EVENT_TYPE_META = 4;
const RRWEB_EVENT_TYPE_CUSTOM = 5;

function hrefMayContainSensitiveParams(href: string): boolean {
  return SENSITIVE_URL_QUERY_PARAMS.some((key) => {
    const pattern = new RegExp(`([?&#]|^)${key}=`, "i");
    return pattern.test(href);
  });
}

function scrubHrefIfSensitive(href: string): string {
  if (!hrefMayContainSensitiveParams(href)) {
    return href;
  }
  return stripSensitiveUrlQueryParams(href);
}

function scrubStringFields(
  record: Record<string, unknown>,
  keys: readonly string[],
): { next: Record<string, unknown>; changed: boolean } {
  const next = { ...record };
  let changed = false;
  for (const key of keys) {
    const value = next[key];
    if (typeof value !== "string" || !hrefMayContainSensitiveParams(value)) {
      continue;
    }
    next[key] = scrubHrefIfSensitive(value);
    changed = true;
  }
  return { next, changed };
}

type ReplayRecordingEvent = ReplayFrameEvent | Record<string, unknown>;

function scrubBreadcrumbFrame(event: ReplayFrameEvent): ReplayFrameEvent {
  const payload = event.data.payload;
  if (!payload || typeof payload !== "object" || !("data" in payload)) {
    return event;
  }
  const frameData = payload.data;
  if (!frameData || typeof frameData !== "object") {
    return event;
  }

  const { next: nextFrameData, changed } = scrubStringFields(frameData as Record<string, unknown>, [
    "url",
    "route",
  ]);
  if (!changed) return event;

  return {
    ...event,
    data: {
      ...event.data,
      payload: { ...payload, data: nextFrameData },
    },
  } as ReplayFrameEvent;
}

function scrubPerformanceSpanFrame(event: ReplayRecordingEvent): ReplayRecordingEvent {
  if (!event.data || typeof event.data !== "object" || !("payload" in event.data)) {
    return event;
  }
  const payload = (event.data as { payload: Record<string, unknown> }).payload;
  if (!payload || typeof payload !== "object") {
    return event;
  }

  const { next: nextPayload, changed: payloadChanged } = scrubStringFields(payload, [
    "description",
  ]);
  let spanDataChanged = false;
  let nextSpanData = payload.data;
  if (nextPayload.data && typeof nextPayload.data === "object") {
    const { next, changed } = scrubStringFields(nextPayload.data as Record<string, unknown>, [
      "previous",
    ]);
    nextSpanData = next;
    spanDataChanged = changed;
  }

  if (!payloadChanged && !spanDataChanged) {
    return event;
  }

  return {
    ...event,
    data: {
      ...(event.data as object),
      payload: {
        ...nextPayload,
        data: nextSpanData,
      },
    },
  };
}

function scrubRrwebMetaEvent(event: ReplayRecordingEvent): ReplayRecordingEvent {
  if (!event.data || typeof event.data !== "object" || !("href" in event.data)) {
    return event;
  }
  const data = event.data as { href?: unknown; width?: number; height?: number };
  if (typeof data.href !== "string" || !hrefMayContainSensitiveParams(data.href)) {
    return event;
  }

  return {
    ...event,
    data: {
      ...data,
      href: scrubHrefIfSensitive(data.href),
    },
  };
}

function scrubReplayUrlsField(event: ReplayRecordingEvent): ReplayRecordingEvent {
  if (!("urls" in event) || !Array.isArray(event.urls)) {
    return event;
  }
  const urls = event.urls as string[];
  const scrubbedUrls = urls.map((url) =>
    typeof url === "string" ? scrubHrefIfSensitive(url) : url,
  );
  if (scrubbedUrls.every((url, index) => url === urls[index])) {
    return event;
  }
  return { ...event, urls: scrubbedUrls };
}

export function scrubReplayRecordingEvent(
  event: ReplayRecordingEvent,
): ReplayRecordingEvent | null {
  if (!event || typeof event !== "object") {
    return event;
  }

  let next = scrubReplayUrlsField(event);

  const eventType = (next as { type?: unknown }).type;
  if (eventType === RRWEB_EVENT_TYPE_META) {
    return scrubRrwebMetaEvent(next);
  }

  if (
    eventType === RRWEB_EVENT_TYPE_CUSTOM &&
    next.data &&
    typeof next.data === "object" &&
    (next.data as { tag?: string }).tag === "breadcrumb"
  ) {
    return scrubBreadcrumbFrame(next as ReplayFrameEvent);
  }

  if (
    eventType === RRWEB_EVENT_TYPE_CUSTOM &&
    next.data &&
    typeof next.data === "object" &&
    (next.data as { tag?: string }).tag === "performanceSpan"
  ) {
    return scrubPerformanceSpanFrame(next);
  }

  return next;
}

export function scrubSentryEvent(event: ErrorEvent): ErrorEvent | null {
  const sentryEvent = event as Event;
  if (sentryEvent.type !== "replay_event") {
    return event;
  }
  const replayEvent = sentryEvent as ReplayEvent;
  if (!Array.isArray(replayEvent.urls)) {
    return event;
  }
  return {
    ...replayEvent,
    urls: replayEvent.urls.map((url) => scrubHrefIfSensitive(url)),
  } as ErrorEvent;
}

function patchReplayEventBufferOtpScrub(client: Client): void {
  const replayIntegration = client.getIntegrationByName("Replay") as
    | {
        _replay?: {
          eventBuffer?: {
            addEvent: (recordingEvent: unknown) => Promise<unknown>;
          };
        };
      }
    | undefined;
  const buffer = replayIntegration?._replay?.eventBuffer;
  if (!buffer) {
    return;
  }

  const originalAddEvent = buffer.addEvent.bind(buffer);
  buffer.addEvent = async (recordingEvent: unknown) => {
    const scrubbed = scrubReplayRecordingEvent(recordingEvent as ReplayRecordingEvent);
    if (scrubbed === null) {
      return null;
    }
    return originalAddEvent(scrubbed);
  };
}

export function replayRecordingOtpScrubIntegration(): Integration {
  return {
    name: "ReplayRecordingOtpScrub",
    afterAllSetup(client) {
      patchReplayEventBufferOtpScrub(client);
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
        beforeAddRecordingEvent: (event) =>
          scrubReplayRecordingEvent(event) as ReplayFrameEvent | null | undefined,
      }),
      Sentry.feedbackIntegration({ colorScheme: "system" }),
      replayRecordingOtpScrubIntegration(),
    ],
    tracesSampleRate: 1.0,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    dataCollection: SENTRY_SENSITIVE_DATA_COLLECTION,
    beforeSend: (event: ErrorEvent) => scrubSentryEvent(event),
  };
}
