import * as Sentry from "@sentry/react-router";
import {
  SENSITIVE_URL_QUERY_PARAMS,
  stripSensitiveUrlQueryParams,
} from "#app/utils/sensitive-url-query-params.shared.ts";

export { SENSITIVE_URL_QUERY_PARAMS, stripSensitiveUrlQueryParams };

export const SENTRY_SENSITIVE_DATA_COLLECTION = {
  urlQueryParams: { deny: [...SENSITIVE_URL_QUERY_PARAMS] as string[] },
};

export function buildProductionSentryInitOptions(dsn: string) {
  return {
    dsn,
    integrations: [
      Sentry.captureConsoleIntegration({ levels: ["error"] }),
      Sentry.reactRouterTracingIntegration(),
      Sentry.replayIntegration({
        maskAllInputs: true,
      }),
      Sentry.feedbackIntegration({ colorScheme: "system" }),
    ],
    tracesSampleRate: 1.0,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    dataCollection: SENTRY_SENSITIVE_DATA_COLLECTION,
  };
}
