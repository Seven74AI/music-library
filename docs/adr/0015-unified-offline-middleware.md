# ADR-015: Unified Offline Middleware Architecture

**Status:** Accepted
**Date:** 2026-07-30
**Supersedes:** ADR-011 (partially — offline loader architecture), PR #136, PR #137

## Context

The offline feature used a split architecture with two competing mechanisms:

1. **Route-level `clientLoader`** (`defineOfflineClientLoader` / `createOfflineClientLoader`)
   — individual routes had their own `clientLoader` function that branched on
   `navigator.onLine`. These loaders set `clientLoader.hydrate = true`, which
   triggered React Router v8's internal `foundOptOutRoute` single-fetch path.

2. **Middleware-based patching** (`offlineClientMiddleware` + `patchOfflineDataStrategyResults`)
   — a global middleware ran on every data request and substituted offline stub
   data for routes WITHOUT their own `clientLoader`.

The system distinguished between "live" routes (own clientLoader) and "stub"
routes (middleware-provided fallback). This dual mechanism caused several
problems:

- **`SingleFetchNoResultError`**: `clientLoader.hydrate = true` on root (and
  leaf routes) forced React Router into the `foundOptOutRoute` path, where the
  single-fetch hydration response excluded layout routes without their own
  clientLoaders. This manifested as "No result found for routeId 'routes/music'"
  errors, silently caught by ErrorBoundary components.

- **Inconsistent offline handling**: Root used an inline clientLoader; leaf
  routes used `defineOfflineClientLoader` wrapping `createOfflineClientLoader`;
  the middleware handled everything else. Three different code paths for the
  same concern.

- **Fragile coupling**: `shouldSkipOfflineMiddlewareRoute` had to know which
  routes were "live" vs. "stub". Adding a new offline-capable route required
  coordination between the policy map, the route file, and the skip logic.

- **Dead configuration**: `OFFLINE_ROUTE_POLICIES["root"]` defined `onlineLoader`
  and `offlineLoader` callbacks that root's inline `clientLoader` completely
  ignored.

## Decision

**Unify all offline data handling through a single middleware layer.** No route
exports a `clientLoader` for offline purposes. The middleware handles everything:

### Architecture

```
┌─────────────────────────────────────────────┐
│              offlineClientMiddleware         │
│                                             │
│  if (isOfflineEnvironment()) {               │
│    // redirect blocked routes if needed      │
│    results = await next()  // will fail      │
│    return patchWithOfflineStubs(results)      │
│  } else {                                   │
│    results = await next()  // online         │
│    persistOfflineRootShell(rootResult)       │
│    return results                            │
│  }                                          │
└─────────────────────────────────────────────┘
```

### Route policies — one map, one mechanism

All routes use the same stub resolution system. The old `mode: "live"` and
`mode: "stub"` distinction is gone. Every route with offline fallback data
gets an entry in `OFFLINE_ROUTE_POLICIES`:

```ts
type StubEntry =
  | { kind: "sync"; value: OfflineStubValue } // constant, pathname-based
  | { kind: "async"; fn: AsyncOfflineStubFn }; // async (IndexedDB queries)
```

Previously "live" routes (root, library, playlists, downloads, home) are now
regular policy entries. Routes not in the map get `OFFLINE_EMPTY ({})`.

### Route files — no offline code

Routes no longer import or export any offline infrastructure. Components that
need to render different UI when offline check for the offline data shape
(e.g., `"offline" in loaderData`). The middleware transparently provides the
correct data shape based on network status.

### What was removed

| File                              | What                                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `define-offline-client-loader.ts` | Entire file (wrapper that set `hydrate = true`)                                                      |
| `offline-loader.client.ts`        | `createOfflineClientLoader`, `loadWithOfflineFallback`, `isLikelyNetworkFailure`, `ServerLoaderData` |
| `root.tsx`                        | `clientLoader` export (inline, no longer needed)                                                     |
| `library.index.tsx`               | `clientLoader` + `HydrateFallback`                                                                   |
| `playlists.index.tsx`             | `clientLoader` + `HydrateFallback`                                                                   |
| `playlists.$playlistId.tsx`       | `clientLoader` + `HydrateFallback`                                                                   |
| `_marketing+/index.tsx`           | `clientLoader` + `HydrateFallback`                                                                   |

### Exception: `downloads.tsx`

`downloads.tsx` has no server `loader` — it always reads from IndexedDB. A
plain `clientLoader` (without `hydrate = true`) remains on this route. Since
there is no server loader, React Router's `foundOptOutRoute` mechanism is not
triggered (it only activates for routes with BOTH `clientLoader` AND `loader`).

## Consequences

### Positive

- **No `clientLoader.hydrate = true`** — eliminates `foundOptOutRoute` and
  `SingleFetchNoResultError` at the architectural level.
- **Single mechanism** — one code path for all offline data, easier to reason about.
- **Fewer HTTP requests** — no per-route individual fetches (each `clientLoader`
  calling `serverLoader()` made a separate `/.data?route=X` request).
- **Simpler route files** — no offline imports, no clientLoader/HydrateFallback exports.
- **Middleware owns persistence** — `persistOfflineRootShell` is called once in
  the middleware, not duplicated across route files.

### Negative

- **Async stubs in middleware** — some stubs (library, playlists, downloads) need
  async IndexedDB queries, making the middleware's `patchOfflineDataStrategyResults`
  async. This is acceptable because the middleware was already `async`.
- **`downloads.tsx` exception** — one route keeps a clientLoader, but this is
  justified (no server loader exists).

## Alternatives Considered

### Add clientLoader to all layout routes (PR #136 discussion)

Would have added per-route clientLoaders to prevent `foundOptOutRoute` from
excluding layout route data. Rejected because it increases HTTP requests
(one fetch per route with clientLoader calling serverLoader), adds boilerplate
to every layout route, and doesn't solve the architectural split.

### Remove clientLoader entirely (PR #136)

Broke offline support because root's `OFFLINE_ROUTE_POLICIES` entry still
expected a clientLoader to provide fallback data. The Playwright offline
tests failed.

### Restore clientLoader without hydrate (PR #137)

Worked but kept the split architecture. Root had an inline clientLoader;
leaf routes still used `defineOfflineClientLoader` with `hydrate = true`.
The `foundOptOutRoute` mechanism still activated for leaf route navigations.
Rejected as a half-measure.
