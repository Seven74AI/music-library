# ADR-042: Pin Node 24 LTS; record dependency overrides and deferred advisories

## Status

Accepted

**Date:** 2026-11-13

## Context

Dependabot version updates were enabled on the fork, and its first run surfaced a runtime-image bump and two advisories with no clean automated fix.

- **Node runtime.** Dependabot proposed `node:24 → node:25` (`other/Dockerfile`). Node 25 reached end-of-life on 2026-03-31 and receives no security fixes; Node 26 is the LTS line as of this decision. The runtime is pinned in three places: `package.json` `engines.node`, `other/Dockerfile`, and `.github/workflows/deploy.yml` (`node-version: 24`).
- **js-yaml.** `cosmiconfig` (via `@sly-cli/sly`) pulls `js-yaml@4.3.1`, which has a merge-sequence DoS fixed in `4.3.2`. It is a transitive dependency, so no `package.json` entry exists to bump.
- **minimatch.** `minimatch <11.0.1` (GHSA-g3hv-75wg-m249) is pulled transitively by `@serwist/build` (via `glob@13`), `@sly-cli/sly` (via `glob@10`), `vite-plugin-icons-spritesheet` (via `glob@11`), and `remix-flat-routes` (directly). Forcing `minimatch >=11.0.1` breaks `vite-plugin-icons-spritesheet` (its `glob@11.1.0` is built against `minimatch@10`; the client build fails on a missing sprite). `remix-flat-routes` pulls `minimatch@10` directly, so a `glob` override cannot cover it.

## Decision

1. **Pin Node 24 LTS** across `engines.node`, `other/Dockerfile`, and CI. Ignore the Dependabot docker bump for `node >=25` in `.github/dependabot.yml`. Upgrades off Node 24 are manual and coordinated (not auto-bumped).
2. **Record `js-yaml` via a `package.json` override** (`js-yaml: ^4.3.2`, mirrored in `pnpm-workspace.yaml`), so the transitive cosmiconfig dependency resolves to the fixed version permanently rather than via a fragile lockfile edit.
3. **Defer the `minimatch` advisory.** It is build-time-only (no runtime attack surface) and has no complete fix: a `minimatch` override breaks `vite-plugin-icons-spritesheet`, and a `glob` override leaves `remix-flat-routes`' direct `minimatch@10` uncovered. Revisit when `remix-flat-routes` ships a release on `minimatch@11`.

## Consequences

- Dependabot no longer opens runtime-image bump PRs above Node 24; those are deliberately manual.
- `js-yaml@4.3.2` is enforced for all consumers.
- One known low-severity, build-time-only advisory (minimatch) remains open and documented rather than silently "fixed" with a breaking override.

## References

- Node.js release schedule (Node 25 EOL, Node 26 LTS)
- GHSA-g3hv-75wg-m249 (minimatch)
- `.github/dependabot.yml`, `package.json`, `pnpm-workspace.yaml`
