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

### Environment

- `MOCKS=true` enables mocked external services
- Node.js 22+
- npm (lockfile: `package-lock.json`)
