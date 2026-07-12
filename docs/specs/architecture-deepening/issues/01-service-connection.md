# Issue 1: Service connection module

**Labels:** `ready-for-agent`  
**Blocks:** service-playlist issue  
**Blocked by:** none  
**Spec:** [architecture-deepening.md](../architecture-deepening.md)

## Summary

Create the **service-connection** feature module with a single token seam for all external services (YouTube today).

## Acceptance criteria

- [ ] `resolveServiceAccessToken(serviceName, userId)` returns `{ access_token }` or `null`; refreshes expired tokens when refresh token available
- [ ] `hasServiceConnection(serviceName, userId)` boolean wrapper
- [ ] `disconnectServiceConnection(serviceName, userId)` replaces disconnectYouTube
- [ ] All call sites migrated (sync, listing, home, YouTube routes); old oauth-validation and playlist-utils token helpers removed
- [ ] Unit tests at module interface (null, refresh, mock OAuth)
- [ ] `docs/CONTEXT.md` Service Connection terms accurate

## Implementation notes

From spec § Implementation Decisions → Service connection module. Big-bang migration.

## Testing

Test through module interface only. Prior art: OAuth mocks in service-playlist tests.
