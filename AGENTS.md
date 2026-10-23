# AGENTS.md

Operating guide for Cursor Cloud Agents in this repository.

## Node

Node 24 is required. `package.json` `engines` pins Node `24`. The default shell node may be 22. Before app commands:

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
export PATH="$HOME/.nvm/versions/node/$(nvm version 24)/bin:$PATH"
```

## Cloud environment

`.cursor/environment.json` is the Cloud environment.

- `install` runs on the build.
- `start` migrates and seeds if `./data.db` has no users.
- The Dev Server terminal runs `npm run dev:youtube-mocks` on port 3000.
- Login: `kody` / `kodylovesyou` (admin). `kodyuser` uses the same password (regular user).

The dev server listens on IPv6. Use `http://localhost:3000` or `http://[::1]:3000`. `http://127.0.0.1:3000` can time out.

If the dev server is down, start `npm run dev:youtube-mocks` after loading Node 24. Do not use `npm run dev` or `npm run dev:no-mocks` in the cloud VM; those need a real YouTube API or other secrets.

## Tests

- `npm test -- --run` (Vitest).
- E2E: `npm run test:e2e:run` (headless, builds first).
- Smoke: `npm run test:e2e:smoke`.
- Never `npm run test:e2e` (Playwright UI).
- If Chromium is missing, `npm run test:e2e:install`.

Reset the database with `npx prisma migrate reset --force`.

## Domain docs

Read the glossary at `docs/CONTEXT.md`. Read ADRs in `docs/decisions/` for the area you change, and `docs/adr/` (currently one file). Use glossary terms. If an output contradicts an ADR, say so.

## Issues

Use `gh` against this clone. Remote is `mnlamart/music-library`.

- `ready-for-agent` means implement unattended.
- `needs-info`, `ready-for-human`, and `wontfix` mean stop.

See `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`.

## Pre-commit

The pre-commit hook runs lint, typecheck, and `npm test -- --run`. It does not run E2E.
