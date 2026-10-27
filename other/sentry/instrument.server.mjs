import * as Sentry from "@sentry/react-router";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

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
});
