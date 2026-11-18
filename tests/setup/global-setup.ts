import path from "node:path";
import { type FullConfig } from "@playwright/test";
import { execa } from "execa";
import fsExtra from "fs-extra";
import { BASE_DATABASE_PATH } from "./base-database-path.ts";

// DATABASE_URL is set by playwright.config.ts before this module loads (see ADR-007).
import "dotenv/config";

// Keep E2E session signing aligned with playwright.config / webServer.env (dotenv must not win).
process.env.SESSION_SECRET = "test-session-secret";
process.env.HONEYPOT_SECRET = "test-honeypot-secret";

import "#app/utils/env.server.ts";
import "#app/utils/cache.server.ts";

export async function setup() {
  // Ensure the database directory exists before any database operations
  // SQLite requires the parent directory to exist before creating the database file
  const databaseDir = path.dirname(BASE_DATABASE_PATH);
  await fsExtra.ensureDir(databaseDir);

  // Always start from a fresh database: the seed is not idempotent (it `create`s tracks,
  // audio files, userTracks and playlists, and the DB-level `(ownerId, lower(title))` unique
  // index makes re-seeding an existing DB fail with a unique-constraint error).
  await fsExtra.remove(BASE_DATABASE_PATH);

  // Apply migrations (the database was just deleted above, so it's always fresh).
  console.log("📦 Applying database migrations...");
  await execa("npm run migrate:deploy", {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: `file:${BASE_DATABASE_PATH}`,
    },
    shell: true,
  });

  // Generate Prisma Client after migrations to ensure it matches the database schema
  console.log("🔧 Generating Prisma Client...");
  await execa("npx prisma generate", {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: `file:${BASE_DATABASE_PATH}`,
    },
    shell: true,
  });

  // Verify that the User table exists before running seed
  console.log("✅ Verifying database schema...");
  const { PrismaClient } = await import("#prisma/client.js");
  const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");

  const adapter = new PrismaBetterSqlite3({
    url: `file:${BASE_DATABASE_PATH}`,
  });
  const prisma = new PrismaClient({ adapter });

  try {
    // Try to query the User table to verify it exists
    await prisma.user.findFirst({ take: 1 });
    console.log("✅ Database schema verified - User table exists");
    await prisma.userNotification.findFirst({ take: 1 });
    console.log("✅ Database schema verified - UserNotification table exists");
  } catch (error) {
    console.error("❌ Database schema verification failed:", error);
    throw new Error("Database schema verification failed - User table does not exist", {
      cause: error,
    });
  } finally {
    await prisma.$disconnect();
  }

  // Run seed script with correct DATABASE_URL
  console.log("🌱 Seeding database...");
  await execa("npx prisma db seed", {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: `file:${BASE_DATABASE_PATH}`,
    },
    shell: true,
  });
}

// Playwright global setup function
export default async function globalSetup(_config: FullConfig) {
  console.log("🔧 Setting up test database...");
  await setup();
  console.log("✅ Test database setup complete");
}
