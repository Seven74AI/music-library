import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "#prisma/client.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateTrackGenres, normalizeGenreName } from "./genre-migration.server.ts";

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");
const TARGET_MIGRATION = "20261108160000_drop_track_genre";
const HOOK_TIMEOUT = 180_000;
const TEST_TIMEOUT = 120_000;

let tempDir: string;
let preMigrationPath: string;

beforeAll(() => {
  const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const targetIndex = migrations.indexOf(TARGET_MIGRATION);
  if (targetIndex === -1) {
    throw new Error(`${TARGET_MIGRATION} not found in ${MIGRATIONS_DIR}`);
  }

  tempDir = mkdtempSync(join(tmpdir(), "drop-track-genre-migration-"));
  preMigrationPath = join(tempDir, "pre-migration.db");
  const db = new DatabaseSync(preMigrationPath);
  db.exec("PRAGMA foreign_keys=ON;");

  for (const name of migrations.slice(0, targetIndex)) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8"));
  }

  db.exec(`
    INSERT INTO "Service" ("id","name","displayName","baseUrl","isActive","createdAt","updatedAt")
      VALUES ('svc1','svc','Svc','http://x',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
    INSERT INTO "Artist" ("id","name","normalizedName","createdAt","updatedAt")
      VALUES ('a1','Artist','artist',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
    INSERT INTO "Track" ("id","title","artistId","serviceId","externalId","genre","createdAt","updatedAt")
      VALUES ('t1','Song One','a1','svc1','ext1','Rock, Pop',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
    INSERT INTO "Genre" ("id","name","normalizedName","createdAt","updatedAt")
      VALUES ('gjazz','Jazz','jazz',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
    INSERT INTO "_TrackGenres" ("A","B") VALUES ('gjazz','t1');
  `);
  db.close();
}, HOOK_TIMEOUT);

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("drop_track_genre backfill (migrateTrackGenres)", () => {
  it(
    "splits legacy scalar, merges with existing M2M, then drops column",
    async () => {
      const testPath = join(tempDir, `test-${Math.random().toString(36).slice(2)}.db`);
      copyFileSync(preMigrationPath, testPath);

      const prisma = new PrismaClient({
        adapter: new PrismaBetterSqlite3({ url: `file:${testPath}` }),
      });

      try {
        const beforeLinks = await prisma.$queryRaw<Array<{ A: string; B: string }>>`
          SELECT A, B FROM _TrackGenres WHERE B = 't1' ORDER BY A
        `;
        expect(beforeLinks).toEqual([{ A: "gjazz", B: "t1" }]);

        const backfill = await migrateTrackGenres({ client: prisma });
        expect(backfill.tracksProcessed).toBe(1);
        expect(backfill.linksCreated).toBeGreaterThanOrEqual(2);

        const afterBackfill = await prisma.$queryRaw<
          Array<{ genreName: string; normalizedName: string }>
        >`
          SELECT g.name AS genreName, g."normalizedName" AS normalizedName
          FROM _TrackGenres tg
          JOIN Genre g ON g.id = tg.A
          WHERE tg.B = 't1'
          ORDER BY g.name
        `;
        expect(afterBackfill.map((row) => row.genreName).sort()).toEqual(["Jazz", "Pop", "Rock"]);
        expect(afterBackfill.find((row) => row.genreName === "Rock")?.normalizedName).toBe(
          normalizeGenreName("Rock"),
        );

        await prisma.$disconnect();

        const db = new DatabaseSync(testPath);
        db.exec("PRAGMA foreign_keys=ON;");
        db.exec(readFileSync(join(MIGRATIONS_DIR, TARGET_MIGRATION, "migration.sql"), "utf8"));

        const genreColumn = (
          db.prepare(`PRAGMA table_info('Track')`).all() as Array<{ name: string }>
        ).some((column) => column.name === "genre");
        expect(genreColumn).toBe(false);

        const finalGenres = db
          .prepare(
            `SELECT g.name FROM _TrackGenres tg JOIN Genre g ON g.id = tg.A WHERE tg.B = 't1' ORDER BY g.name`,
          )
          .all() as Array<{ name: string }>;
        expect(finalGenres.map((row) => row.name)).toEqual(["Jazz", "Pop", "Rock"]);
        db.close();
      } finally {
        await prisma.$disconnect().catch(() => undefined);
      }
    },
    TEST_TIMEOUT,
  );
});
