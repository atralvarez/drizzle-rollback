import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgresDialect } from "../src/dialects/postgres.js";
import { rollback } from "../src/runner.js";
import type { ResolvedConfig } from "../src/types.js";

let container: StartedPostgreSqlContainer;
let url: string;
let dir: string;
let out: string;
let config: ResolvedConfig;

const UP_0 = 'CREATE TABLE "a" ("id" serial PRIMARY KEY);';
const UP_1 = 'CREATE TABLE "b" ("id" serial PRIMARY KEY);';
const hash = (sql: string) => createHash("sha256").update(sql).digest("hex");

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  url = container.getConnectionUri();
});
afterAll(async () => container.stop());

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "dzr-run-"));
  out = join(dir, "drizzle");
  mkdirSync(join(out, "meta"), { recursive: true });
  writeFileSync(
    join(out, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "postgresql",
      entries: [
        { idx: 0, version: "7", when: 1, tag: "0000_a", breakpoints: true },
        { idx: 1, version: "7", when: 2, tag: "0001_b", breakpoints: true },
      ],
    }),
  );
  writeFileSync(join(out, "0000_a.sql"), UP_0);
  writeFileSync(join(out, "0001_b.sql"), UP_1);
  writeFileSync(join(out, "0000_a.down.sql"), 'DROP TABLE "a";');
  writeFileSync(join(out, "0001_b.down.sql"), 'DROP TABLE "b";');

  config = {
    dialect: "postgresql",
    out,
    migrationsTable: "__drizzle_migrations",
    migrationsSchema: "drizzle",
    dbCredentials: { url },
  };

  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS "drizzle" CASCADE');
  await client.query('DROP TABLE IF EXISTS "a"');
  await client.query('DROP TABLE IF EXISTS "b"');
  await client.query('CREATE SCHEMA "drizzle"');
  await client.query(
    'CREATE TABLE "drizzle"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)',
  );
  await client.query(
    'INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, 1), ($2, 2)',
    [hash(UP_0), hash(UP_1)],
  );
  await client.query(UP_0);
  await client.query(UP_1);
  await client.end();
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function appliedHashes(): Promise<string[]> {
  const client = new Client({ connectionString: url });
  await client.connect();
  const res = await client.query(
    'SELECT hash FROM "drizzle"."__drizzle_migrations" ORDER BY created_at',
  );
  await client.end();
  return res.rows.map((r) => r.hash);
}

describe("rollback", () => {
  it("reverts the most recent migration by default", async () => {
    const result = await rollback({ config, count: 1, yes: true });

    expect(result.reverted).toEqual(["0001_b"]);
    expect(await appliedHashes()).toEqual([hash(UP_0)]);
  });

  it("reverts the last N newest-first", async () => {
    const result = await rollback({ config, count: 2, yes: true });

    expect(result.reverted).toEqual(["0001_b", "0000_a"]);
    expect(await appliedHashes()).toEqual([]);
  });

  it("dry-run reports SQL without changing the DB", async () => {
    const result = await rollback({ config, count: 1, yes: true, dryRun: true });

    expect(result.reverted).toEqual([]);
    expect(result.planned).toEqual([{ tag: "0001_b", sql: 'DROP TABLE "b";' }]);
    expect(await appliedHashes()).toEqual([hash(UP_0), hash(UP_1)]);
  });

  it("reverts everything applied after the --to target", async () => {
    const result = await rollback({ config, to: "0000_a", yes: true });

    expect(result.reverted).toEqual(["0001_b"]);
    expect(await appliedHashes()).toEqual([hash(UP_0)]);
  });

  it("refuses to revert a migration whose down is an unedited stub", async () => {
    writeFileSync(join(out, "0001_b.down.sql"), "-- drizzle-rollback:stub\n");

    await expect(rollback({ config, count: 1, yes: true })).rejects.toThrow(/stub/i);
    expect(await appliedHashes()).toEqual([hash(UP_0), hash(UP_1)]);
  });

  it("ignores an unmatched baseline row (e.g. drizzle-kit push) when reverting recent migrations", async () => {
    const client = new Client({ connectionString: url });
    await client.connect();
    await client.query(
      'INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES (\'db_push_baseline\', 0)',
    );
    await client.end();

    const result = await rollback({ config, count: 1, yes: true });

    expect(result.reverted).toEqual(["0001_b"]);
    // The baseline (oldest) and 0000_a remain — the baseline never blocked the revert.
    expect(await appliedHashes()).toEqual(["db_push_baseline", hash(UP_0)]);
  });

  it("still errors when the migration being reverted has no matching file", async () => {
    const client = new Client({ connectionString: url });
    await client.connect();
    await client.query(
      'INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES (\'orphan_head\', 3)',
    );
    await client.end();

    await expect(rollback({ config, count: 1, yes: true })).rejects.toThrow(
      /no matching \.sql file/i,
    );
  });
});
