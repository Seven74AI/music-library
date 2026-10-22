# Contributing to Music Library

## For AI Workers

This project uses automated kanban workers (coder, reviewer, researcher, planner).

### Quick Start

```bash
npm install
cp .env.example .env
npx prisma migrate deploy && npx prisma generate --sql
```

### Running Tests

```bash
# All tests (background-friendly for workers)
npm run test:all

# Individual suites
npm run typecheck     # TypeScript
npm test -- --run     # Vitest unit tests
npm run test:e2e:run  # Playwright E2E
npm run lint          # ESLint
```

### PR Workflow

1. Branch from `main`: `git checkout -b feat/t_XXXXX`
2. Implement + tests
3. Run `npm run test:all` — must pass
4. Push to fork, create PR
5. CI must pass (`lint`, `typecheck`, `vitest`, `playwright`)

### Cursor cloud agents

Implementation and review tasks are delegated to Cursor cloud agents. These
agents authenticate as the Cursor GitHub App and push branches directly to this
repository — unlike the human PR Workflow above, where a contributor pushes to
their own fork and opens a PR from it.

- Implementation agents open a PR with their changes.
- Review agents leave a GitHub review carrying an agent verdict of `APPROVE`,
  `REQUEST_CHANGES`, or `REJECT`. The native GitHub review event is limited to
  Approve / Request changes / Comment — there is no native `REJECT` state, so a
  `REJECT` verdict is conveyed via the review body (Comment or Request changes)
  rather than a distinct event.

For local Cursor Cloud setup (Node 24, `.cursor/environment.json`, dev login),
see the "Cursor Cloud specific instructions" section of `CLAUDE.md`.

### Environment

- `MOCKS=true` enables mocked external services
- Node.js 22+
- npm (lockfile: `package-lock.json`)
