# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Agent skills

### Issue tracker

GitHub Issues on `mnlamart/music-library`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Glossary is `docs/CONTEXT.md`. ADRs are `docs/decisions/` plus `docs/adr/`. See `docs/agents/domain.md`.

## Cursor Cloud specific instructions

Cloud Agents are configured by `.cursor/environment.json`, which runs the dev
server (`npm run dev:youtube-mocks`, MSW plus YouTube mocks) on
`http://localhost:3000` and seeds the database automatically.

- **Node 24 required.** `package.json` `engines` pins Node `24` and react-router
  needs > 22.22.0, but the base image ships Node 22. Load Node 24 via nvm before
  running app commands (the environment scripts already do this):

  ```bash
  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
  export PATH="$HOME/.nvm/versions/node/$(nvm version 24)/bin:$PATH"
  ```

- **Dev login:** `kody` / `kodylovesyou`.
- **If the dev server isn't running**, start it with `npm run dev:youtube-mocks`
  (after loading Node 24 as above); it serves on port 3000.
- **E2E:** `npm run test:e2e:run` is headless. `npm run test:e2e` is the
  interactive Playwright UI.
- **Reset/reseed the database:** `npx prisma migrate reset --force`.
