# ADR-007: Playwright Test Database Configuration

## Status
Accepted

## Context
The Music Library application uses Playwright for end-to-end (e2e) testing. During the migration to Prisma 7, we encountered issues where test files were querying the wrong database (development database instead of test database), causing test failures and data inconsistencies.

### Problems with Previous Approach
test
#### 1. Database URL Inconsistency
- Test files directly importing `prisma` from `db.server.ts` were using the default database (`file:./prisma/data.db`)
- The webServer process had `DATABASE_URL` set correctly, but the test process did not
- This created a mismatch where:
  - HTTP requests (handled by webServer) used the test database ✅
  - Direct `prisma` calls in tests used the development database ❌
  - Application functions called from tests (like `verifyUserPassword()`) used the development database ❌

#### 2. Import Order Dependency
Test files had inconsistent import orders:
```typescript
// Some test files
import { prisma } from '#app/utils/db.server.ts'  // ← Uses default DATABASE_URL
import { test } from '#tests/playwright-utils.ts'  // ← Too late to set DATABASE_URL
```

When `db.server.ts` is imported, it immediately:
1. Calls `getDatabaseUrl()` which reads `process.env.DATABASE_URL`
2. Uses `remember()` to cache the Prisma client instance
3. If `DATABASE_URL` isn't set yet, it defaults to `file:./prisma/data.db` (development database)

#### 3. Multiple Database Access Patterns
Tests use the database in three different ways:
1. **Direct Prisma calls**: `prisma.userPlaylist.create()` in test files
2. **Application functions**: `verifyUserPassword()` which internally uses `prisma`
3. **Custom matchers**: `toHaveSessionForUser()` which queries `prisma.session`

All three patterns needed to use the test database, but only HTTP requests were correctly configured.

#### 4. Test Isolation Failures
- Tests were creating data in the development database
- Tests were reading from the development database
- Test data was not isolated from development data
- Tests could interfere with each other and with development work

### Requirements
- All test database operations must use the test database (`./tests/prisma/base.db`)
- Solution must work regardless of import order in test files
- Solution must work for all database access patterns (direct calls, application functions, custom matchers)
- Solution must be maintainable and clear
- Solution must not require changes to every test file
- Solution must work for both the test process and webServer process

## Decision
Set `DATABASE_URL` in `playwright.config.ts` at the top level, **before** any other imports, ensuring it's available when any module is loaded.

### Implementation

```typescript
// playwright.config.ts
import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// Set DATABASE_URL for the test process BEFORE any other imports
// This ensures it's available when test files import prisma from db.server.ts
// This must be set before 'dotenv/config' to ensure it takes precedence
const BASE_DATABASE_PATH = path.join(process.cwd(), './tests/prisma/base.db')
process.env.DATABASE_URL = `file:${BASE_DATABASE_PATH}`

// Now load dotenv (which won't override DATABASE_URL if it's already set)
import 'dotenv/config'
```

### Why This Approach

#### 1. Config File Loads First
Playwright loads `playwright.config.ts` before any test files, ensuring `DATABASE_URL` is set before any test code runs.

#### 2. Works Regardless of Import Order
Even if test files import `prisma` before importing from `playwright-utils.ts`, `DATABASE_URL` is already set because the config file was loaded first.

#### 3. Covers All Access Patterns
- ✅ Direct `prisma` calls: `getDatabaseUrl()` reads the already-set `DATABASE_URL`
- ✅ Application functions: Functions using `prisma` from `db.server.ts` use the test database
- ✅ Custom matchers: Matchers using `prisma` use the test database
- ✅ HTTP requests: `webServer.env` also sets `DATABASE_URL` for the webServer process

#### 4. Single Source of Truth
The test database path is defined once in `playwright.config.ts` and used consistently:
- Test process: Set via `process.env.DATABASE_URL` in config
- WebServer process: Set via `webServer.env.DATABASE_URL` in config
- Global setup: Uses `BASE_DATABASE_PATH` constant

## Consequences

### Positive
- ✅ **Works for All Test Files**: No need to modify individual test files
- ✅ **Import Order Independent**: Works regardless of how test files import modules
- ✅ **Covers All Patterns**: Direct calls, application functions, and custom matchers all work
- ✅ **Single Source of Truth**: Database path defined once in config
- ✅ **Clear and Maintainable**: Easy to understand and modify
- ✅ **No Test File Changes**: Existing tests work without modification
- ✅ **Consistent with WebServer**: Both processes use the same database path constant

### Negative
- ⚠️ **Direct `process.env` Assignment**: Some developers may find this unconventional
- ⚠️ **Config File Complexity**: Config file now has side effects (setting environment variable)
- ⚠️ **Timing Dependency**: Relies on config file loading before test files (which is guaranteed by Playwright)

### Neutral
- 🔄 **Environment Variable Precedence**: `dotenv/config` is loaded after setting `DATABASE_URL`, so `.env` values won't override it
- 🔄 **Global State**: `process.env.DATABASE_URL` is set globally for the test process

## Implementation Details

### File Structure
```
playwright.config.ts
├── Set DATABASE_URL before dotenv/config
├── Define BASE_DATABASE_PATH constant
└── Use BASE_DATABASE_PATH in webServer.env

tests/setup/global-setup.ts
├── Export BASE_DATABASE_PATH (for consistency)
└── Use BASE_DATABASE_PATH for database setup commands
```

### Key Patterns

#### Config File Pattern
```typescript
// Set environment variable BEFORE any imports that might use it
const BASE_DATABASE_PATH = path.join(process.cwd(), './tests/prisma/base.db')
process.env.DATABASE_URL = `file:${BASE_DATABASE_PATH}`

// Load dotenv after (won't override if already set)
import 'dotenv/config'
```

#### WebServer Configuration
```typescript
webServer: {
  env: {
    DATABASE_URL: `file:${BASE_DATABASE_PATH}`,  // Same path as test process
  },
}
```

#### Test File Pattern (No Changes Required)
```typescript
// This works correctly because DATABASE_URL is already set
import { prisma } from '#app/utils/db.server.ts'
import { test } from '#tests/playwright-utils.ts'

test('example', async () => {
  // Uses test database automatically
  const user = await prisma.user.findUnique({ where: { id: '123' } })
})
```

## Alternatives Considered

### Alternative 1: Setup File Imported in playwright-utils.ts
- **Pros**: Centralized setup, similar to Vitest pattern
- **Cons**: Only works if test files import from `playwright-utils.ts` first; fails if they import `prisma` directly first
- **Decision**: Rejected - doesn't solve import order problem

### Alternative 2: cross-env in npm Scripts
- **Pros**: Explicit, follows existing patterns in codebase
- **Cons**: Requires updating every npm script, easy to forget, less maintainable
- **Decision**: Rejected - too many places to update, maintenance burden

### Alternative 3: Set in globalSetup
- **Pros**: Centralized in setup file
- **Cons**: `globalSetup` runs in a separate process, doesn't affect test process
- **Decision**: Rejected - doesn't work for test process

### Alternative 4: Set in Each Test File
- **Pros**: Explicit per test file
- **Cons**: Repetitive, easy to forget, maintenance burden
- **Decision**: Rejected - violates DRY principle

### Alternative 5: Use testPrisma Instead of prisma
- **Pros**: Explicit test database client
- **Cons**: Requires updating all test files, doesn't solve application function calls
- **Decision**: Rejected - doesn't solve all problems, requires many changes

## Migration Strategy

### Phase 1: Identify All Database Access Points
1. Find all test files importing `prisma` directly
2. Find all application functions called from tests
3. Find all custom matchers using `prisma`

### Phase 2: Implement Solution
1. Set `DATABASE_URL` in `playwright.config.ts` before `dotenv/config`
2. Ensure `BASE_DATABASE_PATH` is used consistently
3. Verify `webServer.env` also sets `DATABASE_URL`

### Phase 3: Verification
1. Run all e2e tests
2. Verify tests use test database
3. Verify development database is not modified
4. Check that all test patterns work (direct calls, functions, matchers)

## Success Metrics

### Technical Metrics
- [x] All e2e tests pass
- [x] Test database is used for all test operations
- [x] Development database is not modified by tests
- [x] All database access patterns work (direct, functions, matchers)
- [x] No import order dependencies

### Quality Metrics
- [x] Test isolation is maintained
- [x] Tests don't interfere with development
- [x] Clear and maintainable solution
- [x] Single source of truth for database path

### Developer Experience Metrics
- [x] No changes required to existing test files
- [x] Easy to understand configuration
- [x] Works regardless of import order
- [x] Clear documentation

## Future Considerations

### Extensibility
- Easy to change test database path (single location)
- Easy to add additional test environment variables
- Pattern can be extended for other environment variables

### Maintenance
- Database path is defined in one place
- Clear where to look for test database configuration
- Easy to update if test database location changes

### Testing
- Test database is isolated from development
- Tests can run in parallel without conflicts
- Test database can be reset between test runs

## References

- [Playwright Configuration Documentation](https://playwright.dev/docs/test-configuration)
- [Prisma 7 Migration Guide](https://www.prisma.io/docs/guides/upgrade-guides/upgrading-versions/upgrading-to-prisma-7)
- [Environment Variables in Node.js](https://nodejs.org/api/process.html#process_process_env)
- [Epic Stack Testing Patterns](https://epicweb.dev/epic-stack)

## Related ADRs

- [ADR-001: Type Safety with Zod Validation](./001-type-safety-architecture.md) - Related to test data validation
- [ADR-002: Eliminating Cross-Boundary Imports](./002-cross-boundary-imports.md) - Related to database access patterns

## Revision History

- **2025-01-XX**: Initial version - Documented DATABASE_URL configuration for Playwright tests

