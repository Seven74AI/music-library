import path from "node:path";
import fsExtra from "fs-extra";
import { afterAll } from "vitest";
import { BASE_DATABASE_PATH } from "./base-database-path.ts";

/**
 * Prefer VITEST_WORKER_ID (unique per isolated worker) over VITEST_POOL_ID
 * (1..maxWorkers, reused). Fall back to PID so workers never share one file.
 */
function getPoolKey() {
  return process.env.VITEST_WORKER_ID || process.env.VITEST_POOL_ID || String(process.pid);
}

const poolKey = getPoolKey();
const databasePath = path.join(process.cwd(), `./tests/prisma/data.${poolKey}.db`);

// Set per-worker cache path BEFORE any module imports cache.server.ts.
process.env.CACHE_DATABASE_PATH = path.join(process.cwd(), `./tests/prisma/cache.${poolKey}.db`);

// Copy BEFORE any test module imports prisma. If the file is missing, Prisma /
// better-sqlite3 creates an empty DB and subsequent writes fail with
// "attempt to write a readonly database".
if (!fsExtra.existsSync(BASE_DATABASE_PATH)) {
  throw new Error(
    `Test base database missing at ${BASE_DATABASE_PATH}. globalSetup must run first.`,
  );
}
fsExtra.copyFileSync(BASE_DATABASE_PATH, databasePath);
fsExtra.chmodSync(databasePath, 0o644);

process.env.DATABASE_URL = `file:${databasePath}`;

afterAll(async () => {
  // we *must* use dynamic imports here so the process.env.DATABASE_URL is set
  // before prisma is imported and initialized
  const { prisma } = await import("#app/utils/db.server.ts");
  if (typeof prisma.$disconnect === "function") {
    await prisma.$disconnect();
  }
});
