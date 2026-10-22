import path from "node:path";

/** Shared path for the seeded vitest SQLite base DB (copied per worker). */
export const BASE_DATABASE_PATH = path.join(process.cwd(), `./tests/prisma/base.db`);
