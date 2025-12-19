# Prisma 6 to 7 Migration Documentation

## Overview

This document details the migration from Prisma 6 to Prisma 7 for the Music Library application. The migration introduced a new adapter-based architecture and required significant changes to database client initialization, test configuration, and build processes.

## Key Changes

### 1. Adapter-Based Architecture

Prisma 7 introduced adapter-based database access, requiring explicit adapter configuration for SQLite.

**Before (Prisma 6):**
```typescript
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
```

**After (Prisma 7):**
```typescript
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '#prisma/client.js'

const adapter = new PrismaBetterSqlite3({
  url: getDatabaseUrl(),
})

const prisma = new PrismaClient({ adapter })
```

### 2. Package Dependencies

**New packages added:**
- `@prisma/adapter-better-sqlite3`: "7.0.1"
- `@prisma/instrumentation`: "7.0.1"
- `@prisma/client`: "7.0.1" (upgraded from 6.x)
- `prisma`: "7.0.1" (upgraded from 6.x)

### 3. Import Path Changes

The Prisma Client import path changed due to generator output location:

**Before:**
```typescript
import { PrismaClient } from '@prisma/client'
```

**After:**
```typescript
import { PrismaClient } from '#prisma/client.js'
```

This change was necessary due to an issue with React Router: https://github.com/remix-run/react-router/pull/12644

### 4. Generator Configuration

The Prisma schema generator now outputs to a custom location:

```prisma
generator client {
  provider        = "prisma-client"
  previewFeatures = ["typedSql"]
  output          = "../generated/prisma"
}
```

### 5. New Configuration File

Added `prisma.config.ts` for Prisma configuration:

```typescript
import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
})
```

## Files Modified

### Application Code

#### `app/utils/db.server.ts`
- Added `PrismaBetterSqlite3` adapter import
- Changed PrismaClient import path to `#prisma/client.js`
- Wrapped PrismaClient initialization with adapter
- Maintained query logging and performance monitoring

#### `server/utils/db.ts`
- Added adapter pattern for production worker environment
- Uses singleton pattern for PrismaClient instance
- Simplified logging (no query logging in production)

#### `prisma/seed.ts`
- Updated to use adapter pattern
- Uses `PrismaBetterSqlite3` adapter with DATABASE_URL from environment

### Test Configuration

#### `playwright.config.ts`

**Critical Change:** DATABASE_URL must be set before any imports

```typescript
// Set DATABASE_URL BEFORE any other imports
const BASE_DATABASE_PATH = path.join(process.cwd(), './tests/prisma/base.db')
process.env.DATABASE_URL = `file:${BASE_DATABASE_PATH}`

// Load dotenv after (won't override if already set)
import 'dotenv/config'
```

**Why this matters:**
- Test files import `prisma` from `db.server.ts` immediately
- `db.server.ts` reads `process.env.DATABASE_URL` when imported
- If DATABASE_URL isn't set, it defaults to development database
- Setting it in config ensures it's available before any module loads

**WebServer Configuration:**
```typescript
webServer: {
  env: {
    DATABASE_URL: `file:${BASE_DATABASE_PATH}`,
  },
}
```

#### `tests/setup/global-setup.ts`
- Added migration status checking before applying migrations
- Uses `prisma migrate status` to verify database sync
- Deletes and recreates database if migrations are out of sync
- Uses adapter pattern for PrismaClient verification
- Ensures test database matches current migration files

**Migration Status Check:**
```typescript
const statusResult = await execaCommand('npx prisma migrate status', {
  env: { ...process.env, DATABASE_URL: `file:${BASE_DATABASE_PATH}` },
  reject: false,
})

if (statusResult.exitCode === 0 && 
    statusResult.stdout.includes('Database schema is up to date')) {
  needsMigration = false
} else {
  // Delete database to force clean migration
  await fsExtra.remove(BASE_DATABASE_PATH)
}
```

## Playwright Test Database Issues

### Problem

During migration, tests were querying the wrong database:
- HTTP requests (webServer) used test database ✅
- Direct `prisma` calls in tests used development database ❌
- Application functions called from tests used development database ❌

### Root Cause

1. **Import Order Dependency:** Test files importing `prisma` before `playwright-utils.ts` would use default DATABASE_URL
2. **Module Initialization:** `db.server.ts` reads `process.env.DATABASE_URL` immediately when imported
3. **Environment Variable Timing:** DATABASE_URL wasn't set early enough in the test process

### Solution

Set `DATABASE_URL` in `playwright.config.ts` before any imports, ensuring:
- Test process has DATABASE_URL set before any modules load
- WebServer process has DATABASE_URL set via `webServer.env`
- All database access patterns (direct calls, functions, matchers) use test database
- Works regardless of import order in test files

## Migration Steps

### 1. Update Dependencies

```bash
npm install @prisma/adapter-better-sqlite3@7.0.1 @prisma/client@7.0.1 @prisma/instrumentation@7.0.1 prisma@7.0.1
```

### 2. Update Prisma Schema

Update generator output path:
```prisma
generator client {
  provider        = "prisma-client"
  previewFeatures = ["typedSql"]
  output          = "../generated/prisma"
}
```

### 3. Create `prisma.config.ts`

Add configuration file as shown above.

### 4. Update Database Client Files

Update all files that create PrismaClient instances:
- `app/utils/db.server.ts`
- `server/utils/db.ts`
- `prisma/seed.ts`
- `tests/setup/global-setup.ts`

### 5. Update Playwright Configuration

Set DATABASE_URL before imports in `playwright.config.ts`.

### 6. Update Test Setup

Add migration status checking in `tests/setup/global-setup.ts`.

### 7. Regenerate Prisma Client

```bash
npx prisma generate
```

### 8. Verify Tests

```bash
npm run test:e2e
```

## Breaking Changes

1. **Adapter Required:** PrismaClient now requires an adapter parameter
2. **Import Path:** Changed from `@prisma/client` to `#prisma/client.js`
3. **Generator Output:** Client now generates to `generated/prisma` directory
4. **Test Configuration:** DATABASE_URL must be set before imports in Playwright config

## Benefits

1. **Better Performance:** Adapter-based architecture provides better control over database connections
2. **Type Safety:** Improved TypeScript support with typed SQL preview feature
3. **Test Isolation:** Fixed test database configuration ensures proper isolation
4. **Migration Safety:** Migration status checking prevents test database corruption

## Related Documentation

- [ADR-007: Playwright Test Database Configuration](./decisions/007-playwright-test-database-configuration.md)
- [Official Prisma 7 Migration Guide](https://www.prisma.io/docs/guides/upgrade-guides/upgrading-versions/upgrading-to-prisma-7)
- [Production Database Documentation](./PRODUCTION_DATABASE.md)

## Troubleshooting

### Tests Using Wrong Database

If tests are still using the development database:
1. Verify `DATABASE_URL` is set before imports in `playwright.config.ts`
2. Check that `webServer.env.DATABASE_URL` is set
3. Ensure `BASE_DATABASE_PATH` matches in both locations
4. Restart test runner to clear cached modules

### Migration Status Errors

If migration status check fails:
- Database file may be corrupted
- Migration files may have been renamed
- Run `npx prisma migrate status` manually to diagnose
- Global setup will automatically delete and recreate database if needed

### Import Path Errors

If `#prisma/client.js` import fails:
- Verify `prisma generate` has been run
- Check that `generated/prisma` directory exists
- Verify TypeScript path mapping in `tsconfig.json` includes `#prisma/*`
