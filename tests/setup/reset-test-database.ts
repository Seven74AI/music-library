import { forget } from "@epic-web/remember";
import fsExtra from "fs-extra";
import { BASE_DATABASE_PATH } from "./base-database-path.ts";
import { copyBaseDatabaseToWorker, getWorkerDatabasePath } from "./db-setup.ts";

/**
 * Restore this worker's SQLite files from the seeded base snapshot and drop
 * remembered Prisma/cache singletons so the next import picks up DATABASE_URL.
 *
 * Called before each test file so reused vitest workers do not leak rows
 * (unique constraint / FK failures across suites).
 */
export async function resetTestDatabase(): Promise<void> {
  if (!fsExtra.existsSync(BASE_DATABASE_PATH)) {
    throw new Error(
      `Test base database missing at ${BASE_DATABASE_PATH}. globalSetup must run first.`,
    );
  }

  try {
    const { prisma } = await import("#app/utils/db.server.ts");
    if (typeof prisma.$disconnect === "function") {
      await prisma.$disconnect();
    }
  } catch {
    // Prisma may not be initialized yet on the first file in a worker.
  }

  forget("prisma");
  forget("cacheDb");
  forget("lru-cache");

  copyBaseDatabaseToWorker();

  // Touch path so a stale import cannot silently keep an old file handle.
  void getWorkerDatabasePath();
}
