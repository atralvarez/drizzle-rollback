import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateDownStubs } from "../src/generator.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "fixtures/roundtrip/drizzle");
let container: StartedPostgreSqlContainer;
let url: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  url = container.getConnectionUri();
}, 120_000);
afterAll(async () => {
  await container?.stop();
});

async function runSqlFile(client: Client, path: string): Promise<void> {
  const sql = readFileSync(path, "utf-8");
  for (const stmt of sql.split("--> statement-breakpoint")) {
    if (stmt.trim()) await client.query(stmt);
  }
}

async function publicTables(): Promise<string[]> {
  const client = new Client({ connectionString: url });
  await client.connect();
  const res = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name",
  );
  await client.end();
  return res.rows.map((r) => r.table_name as string);
}

async function columnsOf(table: string): Promise<string[]> {
  const client = new Client({ connectionString: url });
  await client.connect();
  const res = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY column_name",
    [table],
  );
  await client.end();
  return res.rows.map((r) => r.column_name as string);
}

describe("round-trip: FK + index + enum migration", () => {
  const FIXTURE_RICH = join(here, "fixtures/rt-rich/drizzle");

  async function scalar(sql: string, params: unknown[] = []): Promise<unknown> {
    const client = new Client({ connectionString: url });
    await client.connect();
    const res = await client.query(sql, params);
    await client.end();
    return res.rows[0] ? Object.values(res.rows[0])[0] : undefined;
  }

  it("reverts a FK, a DESC composite index, an enum and its column", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "dzr-rt2-")), "drizzle");
    cpSync(FIXTURE_RICH, out, { recursive: true });

    const ups = readdirSync(out)
      .filter((f) => /^\d+_.*\.sql$/.test(f) && !f.endsWith(".down.sql"))
      .sort();
    expect(ups.length).toBe(2);

    const client = new Client({ connectionString: url });
    await client.connect();
    for (const up of ups) await runSqlFile(client, join(out, up));
    await client.end();

    // After the ups: enum type, status column, FK, and index all exist.
    expect(await scalar("SELECT to_regtype('public.book_status') IS NOT NULL")).toBe(true);
    expect(
      await scalar(
        "SELECT count(*)::int FROM information_schema.columns WHERE table_name='books' AND column_name='status'",
      ),
    ).toBe(1);
    expect(
      await scalar(
        "SELECT count(*)::int FROM information_schema.table_constraints WHERE table_name='books' AND constraint_type='FOREIGN KEY'",
      ),
    ).toBe(1);
    expect(
      await scalar(
        "SELECT count(*)::int FROM pg_indexes WHERE tablename='books' AND indexname='books_title_author_idx'",
      ),
    ).toBe(1);

    // Generate the down for the last migration; it must be fully executable (no stub).
    generateDownStubs(out);
    const lastTag = ups[ups.length - 1].replace(/\.sql$/, "");
    const downPath = join(out, `${lastTag}.down.sql`);
    const downSql = readFileSync(downPath, "utf-8");
    expect(downSql).not.toContain("-- drizzle-rollback:stub");

    const c2 = new Client({ connectionString: url });
    await c2.connect();
    await runSqlFile(c2, downPath);
    await c2.end();

    // After the down: all four are gone.
    expect(await scalar("SELECT to_regtype('public.book_status') IS NULL")).toBe(true);
    expect(
      await scalar(
        "SELECT count(*)::int FROM information_schema.columns WHERE table_name='books' AND column_name='status'",
      ),
    ).toBe(0);
    expect(
      await scalar(
        "SELECT count(*)::int FROM information_schema.table_constraints WHERE table_name='books' AND constraint_type='FOREIGN KEY'",
      ),
    ).toBe(0);
    expect(
      await scalar(
        "SELECT count(*)::int FROM pg_indexes WHERE tablename='books' AND indexname='books_title_author_idx'",
      ),
    ).toBe(0);

    // Clean up tables created by migration 0000 so the shared DB is pristine for other tests.
    const c3 = new Client({ connectionString: url });
    await c3.connect();
    await c3.query('DROP TABLE IF EXISTS "books" CASCADE');
    await c3.query('DROP TABLE IF EXISTS "authors" CASCADE');
    await c3.end();

    rmSync(dirname(out), { recursive: true, force: true });
  }, 120_000);
});

describe("round-trip: generated down reverts the up", () => {
  it("dropping the second migration restores the previous schema", async () => {
    // Copy the committed fixture to a temp dir so generate can write .down.sql files there.
    const out = join(mkdtempSync(join(tmpdir(), "dzr-rt-")), "drizzle");
    cpSync(FIXTURE, out, { recursive: true });

    const ups = readdirSync(out)
      .filter((f) => /^\d+_.*\.sql$/.test(f) && !f.endsWith(".down.sql"))
      .sort();
    expect(ups.length).toBe(2);

    // Apply BOTH ups against the real DB.
    const client = new Client({ connectionString: url });
    await client.connect();
    for (const up of ups) await runSqlFile(client, join(out, up));
    await client.end();

    expect(await publicTables()).toEqual(["gadgets", "widgets"]);
    expect(await columnsOf("widgets")).toContain("price");

    // Generate downs; the last migration is fully safe (add column + create table).
    generateDownStubs(out);
    const lastTag = ups[ups.length - 1].replace(/\.sql$/, "");
    const downPath = join(out, `${lastTag}.down.sql`);
    const downSql = readFileSync(downPath, "utf-8");
    expect(downSql).not.toContain("-- drizzle-rollback:stub");

    // Run the generated down.
    const c2 = new Client({ connectionString: url });
    await c2.connect();
    await runSqlFile(c2, downPath);
    await c2.end();

    // Schema is back to migration 0000's state.
    expect(await publicTables()).toEqual(["widgets"]);
    expect(await columnsOf("widgets")).not.toContain("price");

    rmSync(dirname(out), { recursive: true, force: true });
  }, 120_000);
});
