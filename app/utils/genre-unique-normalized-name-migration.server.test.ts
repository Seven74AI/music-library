import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");
const TARGET_MIGRATION = "20261022000000_genre_unique_normalized_name";
const HOOK_TIMEOUT = 120_000;
const TEST_TIMEOUT = 60_000;

/**
 * Replay every migration except the target into a throwaway SQLite file, then
 * seed a Service/Artist plus:
 *   - t1 linked to BOTH 'Rock' (g1) and 'rock' (g2) — the condition that used
 *     to abort the relink with "UNIQUE constraint failed: _TrackGenres.A,
 *     _TrackGenres.B";
 *   - t2 linked ONLY to the duplicate g2 — proves relinking does not lose links.
 *
 * Each test copies this frozen pre-migration DB and applies the target
 * migration, so the expensive replay happens once per file.
 */
let tempDir: string;
let preMigrationPath: string;

beforeAll(() => {
  const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (migrations.indexOf(TARGET_MIGRATION) === -1) {
    throw new Error(`${TARGET_MIGRATION} not found in ${MIGRATIONS_DIR}`);
  }

  const targetIndex = migrations.indexOf(TARGET_MIGRATION);

  tempDir = mkdtempSync(join(tmpdir(), "genre-normalized-name-migration-"));
  preMigrationPath = join(tempDir, "pre-migration.db");
  const db = new DatabaseSync(preMigrationPath);
  db.exec("PRAGMA foreign_keys=ON;");

  // Replay only the migrations that precede the target, so the frozen DB
  // reflects the schema state the target migration was written against — this
  // stays correct even after later migrations land on main (the target is no
  // longer the newest migration).
  for (const name of migrations.slice(0, targetIndex)) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8"));
  }

  db.exec(`
    INSERT INTO "Service" ("id","name","displayName","baseUrl","isActive","createdAt","updatedAt")
      VALUES ('svc1','svc','Svc','http://x',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
    INSERT INTO "Artist" ("id","name","normalizedName","createdAt","updatedAt")
      VALUES ('a1','Artist','artist',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
    INSERT INTO "Track" ("id","title","artistId","serviceId","externalId","createdAt","updatedAt")
      VALUES ('t1','Song One','a1','svc1','ext1',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
    INSERT INTO "Track" ("id","title","artistId","serviceId","externalId","createdAt","updatedAt")
      VALUES ('t2','Song Two','a1','svc1','ext2',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
    INSERT INTO "Genre" ("id","name","normalizedName","createdAt","updatedAt")
      VALUES ('g1','Rock','rock',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
    INSERT INTO "Genre" ("id","name","normalizedName","createdAt","updatedAt")
      VALUES ('g2','rock','rock',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
    INSERT INTO "_TrackGenres" ("A","B") VALUES ('g1','t1');
    INSERT INTO "_TrackGenres" ("A","B") VALUES ('g2','t1');
    INSERT INTO "_TrackGenres" ("A","B") VALUES ('g2','t2');
  `);
  db.close();
}, HOOK_TIMEOUT);

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function applyTargetMigration(): DatabaseSync {
  const testPath = join(tempDir, `test-${Math.random().toString(36).slice(2)}.db`);
  copyFileSync(preMigrationPath, testPath);
  const db = new DatabaseSync(testPath);
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(join(MIGRATIONS_DIR, TARGET_MIGRATION, "migration.sql"), "utf8"));
  return db;
}

describe("genre_unique_normalized_name migration", () => {
  it(
    "applies cleanly when a track links two same-normalizedName genres",
    () => {
      const db = applyTargetMigration();
      try {
        // No throw above means the relink no longer collides on the
        // _TrackGenres_AB_unique index.
        const genres = db.prepare("SELECT id, name, normalizedName FROM Genre ORDER BY id").all();
        const links = db.prepare("SELECT A, B FROM _TrackGenres ORDER BY B, A").all();
        const fts = db
          .prepare("SELECT track_id, genres FROM tracks_fts WHERE track_id = 't1'")
          .all();

        // Duplicate genre dropped; canonical (lowest-id) row survives.
        expect(genres).toEqual([{ id: "g1", name: "Rock", normalizedName: "rock" }]);

        // t1 collapses to one canonical link; t2 re-pointed to g1.
        expect(links).toEqual([
          { A: "g1", B: "t1" },
          { A: "g1", B: "t2" },
        ]);

        // FTS was rebuilt and reflects the canonical genre token.
        expect(fts).toEqual([{ track_id: "t1", genres: "Rock" }]);
      } finally {
        db.close();
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "adds the unique index and drops the redundant non-unique index",
    () => {
      const db = applyTargetMigration();
      try {
        const indexes = db
          .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name IN (?, ?)")
          .all("Genre_normalizedName_key", "Genre_normalizedName_idx") as Array<{
          name: string;
        }>;

        expect(indexes.map((row) => row.name).sort()).toEqual(["Genre_normalizedName_key"]);
      } finally {
        db.close();
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "relinks a track linked only to a non-canonical genre without dropping it",
    () => {
      const db = applyTargetMigration();
      try {
        const genres = db.prepare("SELECT id, name FROM Genre ORDER BY id").all();
        const links = db.prepare("SELECT A, B FROM _TrackGenres WHERE B = 't2'").all();

        expect(genres).toEqual([{ id: "g1", name: "Rock" }]);
        // The lone link to the duplicate (g2) was re-pointed to canonical g1.
        expect(links).toEqual([{ A: "g1", B: "t2" }]);
      } finally {
        db.close();
      }
    },
    TEST_TIMEOUT,
  );
});
