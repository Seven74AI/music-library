import path from "node:path";
import fsExtra from "fs-extra";
import { afterAll, beforeAll } from "vitest";
import { BASE_DATABASE_PATH } from "./base-database-path.ts";
import { resetTestDatabase } from "./reset-test-database.ts";

/**
 * Prefer VITEST_WORKER_ID (unique per isolated worker) over VITEST_POOL_ID
 * (1..maxWorkers, reused). Fall back to PID so workers never share one file.
 */
export function getPoolKey() {
  return process.env.VITEST_WORKER_ID || process.env.VITEST_POOL_ID || String(process.pid);
}

export function getWorkerDatabasePath() {
  return path.join(process.cwd(), `./tests/prisma/data.${getPoolKey()}.db`);
}

export function getWorkerCacheDatabasePath() {
  return path.join(process.cwd(), `./tests/prisma/cache.${getPoolKey()}.db`);
}

/** Copy the seeded base DB and point env vars at this worker's files. */
export function copyBaseDatabaseToWorker() {
  if (!fsExtra.existsSync(BASE_DATABASE_PATH)) {
    throw new Error(
      `Test base database missing at ${BASE_DATABASE_PATH}. globalSetup must run first.`,
    );
  }
  const databasePath = getWorkerDatabasePath();
  fsExtra.copyFileSync(BASE_DATABASE_PATH, databasePath);
  fsExtra.chmodSync(databasePath, 0o644);

  process.env.DATABASE_URL = `file:${databasePath}`;
  process.env.CACHE_DATABASE_PATH = getWorkerCacheDatabasePath();
}

// First import: ensure env is set before any app module reads DATABASE_URL.
copyBaseDatabaseToWorker();

beforeAll(async () => {
  await resetTestDatabase();
});

afterAll(async () => {
  const { prisma } = await import("#app/utils/db.server.ts");
  if (typeof prisma.$disconnect === "function") {
    await prisma.$disconnect();
  }
});
