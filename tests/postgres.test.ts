import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresDialect } from "../src/dialects/postgres.js";
import type { ResolvedConfig } from "../src/types.js";

let container: StartedPostgreSqlContainer;
let config: ResolvedConfig;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const url = container.getConnectionUri();
  config = {
    dialect: "postgresql",
    out: "/unused",
    migrationsTable: "__drizzle_migrations",
    migrationsSchema: "drizzle",
    dbCredentials: { url },
  };
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query('CREATE SCHEMA IF NOT EXISTS "drizzle"');
  await client.query(
    'CREATE TABLE "drizzle"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)',
  );
  await client.query(
    "INSERT INTO \"drizzle\".\"__drizzle_migrations\" (hash, created_at) VALUES ('hash_a', 1), ('hash_b', 2)",
  );
  await client.query('CREATE TABLE "widgets" ("id" serial PRIMARY KEY)');
  await client.end();
});

afterAll(async () => {
  await container.stop();
});

describe("PostgresDialect", () => {
  it("getApplied returns rows oldest-first", async () => {
    const dialect = new PostgresDialect(config);
    const applied = await dialect.getApplied();
    await dialect.close();

    expect(applied.map((r) => r.hash)).toEqual(["hash_a", "hash_b"]);
    expect(applied[0].createdAt).toBe(1);
  });

  it("revertOne runs the down SQL and deletes the row atomically", async () => {
    const dialect = new PostgresDialect(config);
    const before = await dialect.getApplied();
    const last = before[before.length - 1];

    await dialect.revertOne('DROP TABLE "widgets";', last);

    const after = await dialect.getApplied();
    await dialect.close();
    expect(after.map((r) => r.hash)).toEqual(["hash_a"]);

    const client = new Client({ connectionString: container.getConnectionUri() });
    await client.connect();
    const res = await client.query("SELECT to_regclass('public.widgets') AS t");
    await client.end();
    expect(res.rows[0].t).toBeNull();
  });

  it("revertOne rolls back everything when a statement fails", async () => {
    const dialect = new PostgresDialect(config);
    const row = { id: 1, hash: "hash_a", createdAt: 1 };

    await expect(dialect.revertOne("THIS IS NOT SQL;", row)).rejects.toThrow();

    const after = await dialect.getApplied();
    await dialect.close();
    expect(after.some((r) => r.hash === "hash_a")).toBe(true);
  });
});
