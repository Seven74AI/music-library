# Contributing to Music Library

Thanks for your interest in contributing! Music Library is a solo-maintained project — your help is welcome and appreciated.

## Quick Links

- [Good First Issues](https://github.com/mnlamart/music-library/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) — issues tagged for newcomers
- [Help Wanted](https://github.com/mnlamart/music-library/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22) — issues where extra attention is needed
- [Bug Reports](https://github.com/mnlamart/music-library/issues/new?labels=bug) — report a bug
- [Feature Requests](https://github.com/mnlamart/music-library/issues/new?labels=enhancement) — suggest a feature

## Tech Stack

| Area | Technology |
|------|-----------|
| Framework | [Epic Stack](https://www.epicweb.dev/epic-stack) / React Router v7 |
| Database | SQLite + [Prisma](https://www.prisma.io/) |
| Styling | [Tailwind CSS](https://tailwindcss.com/) |
| Unit tests | [Vitest](https://vitest.dev/) |
| E2E tests | [Playwright](https://playwright.dev/) |
| Deployment | [Fly.io](https://fly.io/) |
| Language | TypeScript |

## Development Setup

**Prerequisites:** Node.js 22+, npm, Git

```bash
# 1. Fork and clone
git clone https://github.com/YOUR_USERNAME/music-library.git
cd music-library

# 2. Install dependencies
npm install

# 3. Set up environment
cp .env.example .env
# Edit .env — at minimum add SESSION_SECRET and HONEYPOT_SECRET
# (generate with: openssl rand -hex 32)

# 4. Set up database
npm run setup

# 5. Start dev server (with mocks — no API keys needed)
npm run dev
# Open http://localhost:3000
```

Mocks are enabled by default in development (`MOCKS=true`). This means YouTube API calls, email sending, and other external services are simulated — no real API keys needed to start contributing.

## Running Tests

```bash
# Unit tests (Vitest)
npm run test

# E2E tests (Playwright)
npm run test:e2e:run

# Run everything: unit + E2E + lint + typecheck
npm run validate
```

**E2E testing conventions:**

- Use **Playwright fixtures** for test data — they handle setup and cleanup automatically. See `tests/README.md` for available fixtures (`login()`, `insertNewTrack()`, `insertNewPlaylist()`, etc.).
- Tests run with `MOCKS=true` — external APIs are mocked at the server level.
- Tests must be **parallel-safe** and **self-contained** — never use `beforeEach`/`afterEach` for global cleanup.
- Read `tests/README.md` for the complete E2E testing guide.

## Code Style

This project follows [Epic Stack conventions](https://github.com/epicweb-dev/epic-stack):

- **Formatting:** Prettier (`npm run format` before committing)
- **Linting:** ESLint (`npm run lint` — must pass in CI)
- **TypeScript:** Strict mode (`npm run typecheck` must pass)
- **Imports:** Use `#app/*` and `#tests/*` path aliases

All three checks must pass before a PR will be reviewed. The CI pipeline runs them automatically.

## Pull Request Process

1. **Fork** the repository and create a branch from `main`
2. **Make your changes** — keep them focused and atomic
3. **Add tests** for new features or bug fixes
4. **Run validation:** `npm run validate`
5. **Push** and open a PR against `mnlamart/music-library:main`
6. **Fill out the PR template** — include a summary, test plan, and screenshots if applicable
7. **CI must pass** — lint, typecheck, unit tests, and E2E tests all run automatically
8. **Wait for review** — the maintainer will review and may request changes

**PR checklist** (from the template):

- [ ] Tests updated
- [ ] Docs updated (if relevant)

## Reporting Issues

**Bug reports:** Open an issue with the `bug` label. Include:
- Steps to reproduce
- Expected vs actual behavior
- Screenshots if applicable
- Environment (browser, OS, Node version)

**Feature requests:** Open an issue with the `enhancement` label. Describe the problem you're solving and your proposed solution.

**Questions:** Use the `question` label — the maintainer or other contributors will help.

## Labels

| Label | Purpose |
|-------|---------|
| [`good first issue`](https://github.com/mnlamart/music-library/labels/good%20first%20issue) | Beginner-friendly tasks |
| [`help wanted`](https://github.com/mnlamart/music-library/labels/help%20wanted) | Needs attention from contributors |
| [`bug`](https://github.com/mnlamart/music-library/labels/bug) | Something isn't working |
| [`enhancement`](https://github.com/mnlamart/music-library/labels/enhancement) | New feature or request |
| [`documentation`](https://github.com/mnlamart/music-library/labels/documentation) | Docs improvements |

Start with a `good first issue` if you're new to the project — they're scoped and well-defined.


