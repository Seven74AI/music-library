import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";

const POPULARITY_INDEXES = [
  {
    name: "UserTrack_trackId_isActive_idx",
    model: "UserTrack",
    prismaIndex: "@@index([trackId, isActive])",
    createSql:
      'CREATE INDEX IF NOT EXISTS "UserTrack_trackId_isActive_idx" ON "UserTrack"("trackId", "isActive")',
  },
  {
    name: "UsageEvent_type_trackId_idx",
    model: "UsageEvent",
    prismaIndex: "@@index([type, trackId])",
    createSql:
      'CREATE INDEX IF NOT EXISTS "UsageEvent_type_trackId_idx" ON "UsageEvent"("type", "trackId")',
  },
  {
    name: "UsageEvent_userId_type_trackId_idx",
    model: "UsageEvent",
    prismaIndex: "@@index([userId, type, trackId])",
    createSql:
      'CREATE INDEX IF NOT EXISTS "UsageEvent_userId_type_trackId_idx" ON "UsageEvent"("userId", "type", "trackId")',
  },
] as const;

const MOST_LIKED_SQL = `
SELECT trackId, COUNT(*) as likes
FROM UserTrack
WHERE isActive = 1
GROUP BY trackId
ORDER BY likes DESC
LIMIT 50
`;

const MOST_PLAYED_SQL = `
SELECT trackId, COUNT(*) as plays
FROM UsageEvent
WHERE type = 'play_completed'
GROUP BY trackId
ORDER BY plays DESC
LIMIT 50
`;

function extractModel(schema: string, modelName: string): string {
  const start = schema.indexOf(`model ${modelName} {`);
  if (start < 0) {
    throw new Error(`Missing model ${modelName}`);
  }
  const end = schema.indexOf("\n}", start);
  if (end < 0) {
    throw new Error(`Unclosed model ${modelName}`);
  }
  return schema.slice(start, end);
}

function readSchema(): string {
  return readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");
}

function readMigrationSql(): string {
  const root = join(process.cwd(), "prisma", "migrations");
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readFileSync(join(root, entry.name, "migration.sql"), "utf8"))
    .join("\n");
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function sqlitePathFromDatabaseUrl(url: string): string {
  const withoutQuery = url.split("?")[0] ?? url;
  if (!withoutQuery.startsWith("file:")) {
    throw new Error(`Expected a sqlite file URL, received ${url}`);
  }
  return withoutQuery.slice("file:".length);
}

function openMigratedDatabase(): DatabaseSync {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  return new DatabaseSync(sqlitePathFromDatabaseUrl(databaseUrl), { readOnly: true });
}

function queryPlan(db: DatabaseSync, sql: string): string {
  const rows = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as Array<{ detail: string }>;
  return rows.map((row) => row.detail).join("\n");
}

test("schema declares popularity indexes for global like and play counts", () => {
  const schema = readSchema();

  for (const index of POPULARITY_INDEXES) {
    expect(extractModel(schema, index.model), index.name).toContain(index.prismaIndex);
  }
});

test("a migration creates the three popularity indexes", () => {
  const sql = normalizeSql(readMigrationSql());

  for (const index of POPULARITY_INDEXES) {
    expect(sql, index.name).toContain(normalizeSql(index.createSql));
  }
});

test("migrated database has the popularity indexes and aggregate plans use them", () => {
  const db = openMigratedDatabase();

  try {
    const names = (
      db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (${POPULARITY_INDEXES.map(() => "?").join(", ")})`,
        )
        .all(...POPULARITY_INDEXES.map((index) => index.name)) as Array<{ name: string }>
    ).map((row) => row.name);

    expect(names.sort()).toEqual(POPULARITY_INDEXES.map((index) => index.name).sort());

    const likedPlan = queryPlan(db, MOST_LIKED_SQL);
    const playedPlan = queryPlan(db, MOST_PLAYED_SQL);

    expect(likedPlan).toMatch(/USING (?:COVERING )?INDEX UserTrack_trackId_isActive_idx/);
    expect(playedPlan).toMatch(
      /SEARCH UsageEvent USING (?:COVERING )?INDEX UsageEvent_type_trackId_idx/,
    );
  } finally {
    db.close();
  }
});
