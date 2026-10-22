import { redirect, type DataStrategyResult, type MiddlewareFunction } from "react-router";
import { isOfflineEnvironment } from "#app/features/offline-app/is-offline-environment.client.ts";
import type { OfflineRootShell } from "#app/features/offline-app/offline-root-shell.client.ts";
import { persistOfflineRootShell } from "#app/features/offline-app/offline-root-shell.client.ts";
import {
  getOfflineRedirectTarget,
  resolveOfflineData,
  shouldSkipOfflineMiddlewareRoute,
} from "#app/features/offline-app/offline-route-policies.client.ts";

declare global {
  interface Window {
    __reactRouterHdrActive?: boolean;
  }
}

/**
 * Returns true when a data strategy result should be substituted with offline
 * data.  Substitutes when the result is missing, errored, or a network failure.
 */
export function shouldSubstituteOfflineResult(result: DataStrategyResult | undefined) {
  if (!result) return true;
  if (result.type === "data") return false;
  return true;
}

/**
 * Patch ALL data strategy results with offline data.
 *
 * Now handles every route uniformly — no more "live" vs "stub" split.
 * Routes with entries in OFFLINE_ROUTE_POLICIES get their offline stub;
 * skipped routes (API, resources, auth) are left untouched;
 * unlisted routes get OFFLINE_EMPTY ({}).
 */
async function patchOfflineDataStrategyResults(
  results: Record<string, DataStrategyResult>,
  request: Request,
) {
  const patched: Record<string, DataStrategyResult> = { ...results };

  for (const [routeId, result] of Object.entries(results)) {
    if (shouldSkipOfflineMiddlewareRoute(routeId)) continue;
    if (!shouldSubstituteOfflineResult(result)) continue;

    patched[routeId] = {
      type: "data",
      result: await resolveOfflineData(routeId, request),
    };
  }

  return patched;
}

/**
 * Middleware that handles offline mode for ALL routes.
 *
 * Online path:  runs data strategy normally, persists root shell for
 *               future offline use.
 * Offline path: runs data strategy (which will fail), then patches
 *               all results with offline stubs.
 *
 * Server path:  passes through directly — offline logic is browser-only.
 *               React Router v8 runs clientMiddleware during SSR data
 *               strategy execution, but `document` does not exist on the
 *               server (Node ≥21 exposes global `navigator` but not `document`).
 *
 * Architecture: single unified layer — no more clientLoader.hydrate
 * on individual routes.  All offline data comes through this middleware.
 */
export const offlineClientMiddleware: MiddlewareFunction<
  Record<string, DataStrategyResult>
> = async ({ request }, next) => {
  // ── Server guard ──────────────────────────────────────────────────────
  // This middleware handles browser online/offline transitions exclusively.
  // React Router v8 runs clientMiddleware during SSR data strategy execution
  // (see: getTurboStreamSingleFetchDataStrategy → args.runClientMiddleware),
  // but offline logic does not apply on the server — pass through directly.
  //
  // Using `typeof document` rather than `typeof window` or `typeof navigator`
  // because `document` is the DOM entry point and the most definitive signal
  // that we're in a browser environment.  Node ≥21 exposes global `navigator`
  // (with `onLine: undefined`), but not `document`.
  if (typeof document === "undefined") {
    return next();
  }

  // Guards against React Router 8.2.0 single-fetch empty-routes shortcut.
  // Without this, hydration on routes with HydrateFallback + embedded stream
  // data resolves singleFetchDfd with { routes: {} } instead of fetching.
  // Mirrors what the Vite HMR refresh-utils.mjs does in dev.
  window.__reactRouterHdrActive = true;

  const offline = isOfflineEnvironment();

  if (offline) {
    const redirectTo = getOfflineRedirectTarget(request);
    if (redirectTo) throw redirect(redirectTo);
  }

  const results = await next();

  // Online: persist root shell for offline use
  if (!offline) {
    const rootResult = results["root"];
    if (rootResult?.type === "data" && rootResult.result) {
      const shell = rootResult.result as OfflineRootShell;
      persistOfflineRootShell({
        user: shell.user,
        requestInfo: {
          ...shell.requestInfo,
          userPrefs: {
            theme: shell.requestInfo.userPrefs.theme ?? "light",
          },
        },
        ENV: shell.ENV,
      });
    }
    return results;
  }

  // Offline: patch all results with offline stubs
  return patchOfflineDataStrategyResults(results, request);
};
