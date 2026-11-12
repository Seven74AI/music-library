# Production Deploy Runbook

Boot path and the invariants that keep `music-library-5a00` deployable. Read before
changing anything on the boot/deploy path: `other/Dockerfile`, `other/Dockerfile.dockerignore`,
`other/litefs.yml`, `scripts/prisma-migrate-deploy.ts`, the healthcheck route, or
`app/utils/env.server.ts`.

## Boot path (Fly, single machine, in-place)

`CMD ["litefs","mount"]` → `other/litefs.yml` execs, in order:

1. `npm run migrate:deploy` (if-candidate) — `tsx scripts/prisma-migrate-deploy.ts`:
   genre backfill (if `Track.genre` still exists AND the drop migration is pending),
   then `prisma migrate deploy`.
2. `sqlite3` WAL pragmas.
3. `npm start` → `node --import=other/sentry/instrument.server.mjs .` → `server-build/index.js`.

Fly's http_check probes `GET /resources/healthcheck` (and `/litefs/health`) until 200; only then
is the machine healthy and the deploy complete.

## Invariants — each has caused a prod 502

### 1. Boot-path scripts must ship in the image
`migrate:deploy` runs a TS script (`scripts/prisma-migrate-deploy.ts`). `other/Dockerfile.dockerignore`
excludes `/scripts/*` with explicit exceptions. If you add a script to the boot path, add it — and
every file it imports — to the dockerignore exceptions, and keep its runtime deps in `dependencies`
(not `devDependencies`; the image runs `npm prune --omit=dev`). A missing script makes litefs `exec`
fail, so the app never boots and the deploy times out.

### 2. The healthcheck must self-probe loopback, never SITE_URL
`app/routes/resources+/healthcheck.tsx` issues a HEAD self-fetch to prove the server answers. It must
target `loopbackInternalUrl()` (`http://127.0.0.1:${PORT}`), NOT `trustedInternalUrl()`/`SITE_URL`.
Fetching the public URL deadlocks a single-machine in-place deploy: the public edge returns 502 until
this check passes, so the check can never pass. `trustedInternalUrl` (SITE_URL-based) remains correct
for admin/curator internal-API proxying (SSRF); it is only wrong for a self-probe.

### 3. Env validation fails at first request, not boot
`app/entry.server.tsx` runs `init()` at module top level, which loads lazily on the first request via
the build-import path. A missing/invalid required env var makes every route — including the
healthcheck — return 500, indistinguishable from a dead app in the deploy log. Required-in-prod vars
are in `app/utils/env.server.ts` (`isProduction ? z.string() : ...`). After changing them, provision
Fly secrets before deploying.

## Diagnosing a failed deploy

- **Deploy transcript** — the GitHub Actions `🚀 Deploy Production` step holds the real `flyctl deploy`
  output; the job title does not.
- **Signature** `Machine <id> reached started state` + `timeout reached waiting for health checks to
  pass` = process running, healthcheck failing (500/hang), not a boot crash. A passing TCP `smoke
  check` with a failing HTTP `health` check narrows it to the app/route layer.
- **Reproduce locally** — `npm run build`, migrate a scratch DB, boot the production server with the
  full production env, then `curl localhost:8081/resources/healthcheck`. A 500 here prints the exact
  failing cause (env var, self-fetch, DB). Kill stray test servers first (`pkill -9 -f
  instrument.server.mjs`) or you get `Port 8081 is not available` and a false result.
