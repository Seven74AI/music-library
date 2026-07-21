import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { getDatabaseUrl } from "./database-url.server.ts";

afterEach(() => {
  delete process.env.DATABASE_URL;
});

test("strips query params that break better-sqlite3", () => {
  process.env.DATABASE_URL = "file:./data.db?connection_limit=1";

  expect(getDatabaseUrl()).toBe(`file:${join(process.cwd(), "data.db")}`);
});

test("resolves relative file paths to absolute paths", () => {
  process.env.DATABASE_URL = "file:./data.db";

  expect(getDatabaseUrl()).toBe(`file:${join(process.cwd(), "data.db")}`);
});

test("keeps absolute file paths unchanged", () => {
  process.env.DATABASE_URL = "file:/tmp/music-library.db";

  expect(getDatabaseUrl()).toBe("file:/tmp/music-library.db");
});
