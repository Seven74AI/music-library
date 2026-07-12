# Issue 6: Offline app module

**Labels:** `ready-for-agent`  
**Blocks:** none  
**Blocked by:** none  
**Spec:** [architecture-deepening.md](../architecture-deepening.md)

## Summary

Create **offline-app** feature: unified OFFLINE_ROUTE_POLICIES registry, middleware integration, shared clientLoader helper, root shell cache. Keep offline-storage as public device I/O seam.

## Acceptance criteria

- [ ] Single OFFLINE_ROUTE_POLICIES: `{ mode: 'live' | 'stub', offlineLoader?, stub? }`
- [ ] Middleware applies stubs; skips live/self-managed routes
- [ ] createOfflineClientLoader() helper replaces per-route duplication
- [ ] offline-root-shell moved into offline-app; root imports from there
- [ ] Old offline-route utils registry/fallbacks deleted (big bang)
- [ ] getOfflineStorage() remains public — offline-app does not wrap it
- [ ] Tests for policy registry, middleware patching, clientLoader fallback

## Implementation notes

Self-contained; can run in parallel with other issues. Aligns with ADR-013 offline scope.

## Testing

Prior art: offline-route-loader, offline-root-shell tests.
