import { describe, expect, it } from "vitest";
import { STUB_MARKER } from "../src/constants.js";
import { emitDown } from "../src/dialects/postgres/emit.js";
import type { Operation } from "../src/diff/operations.js";
import type { Snapshot } from "../src/snapshot/types.js";

describe("emitDown — safe ops", () => {
  it("renders DROP TABLE", () => {
    const { sql, hasUnresolved } = emitDown([{ kind: "dropTable", schema: "", table: "users" }]);
    expect(sql).toBe('DROP TABLE "users";');
    expect(hasUnresolved).toBe(false);
  });

  it("qualifies non-public schema", () => {
    const { sql } = emitDown([{ kind: "dropTable", schema: "audit", table: "log" }]);
    expect(sql).toBe('DROP TABLE "audit"."log";');
  });

  it("renders DROP COLUMN and DROP INDEX", () => {
    expect(
      emitDown([{ kind: "dropColumn", schema: "", table: "users", column: "email" }]).sql,
    ).toBe('ALTER TABLE "users" DROP COLUMN "email";');
    expect(emitDown([{ kind: "dropIndex", schema: "", name: "users_email_idx" }]).sql).toBe(
      'DROP INDEX "users_email_idx";',
    );
  });

  it("renders constraint drops", () => {
    expect(emitDown([{ kind: "dropForeignKey", schema: "", table: "a", name: "a_b_fk" }]).sql).toBe(
      'ALTER TABLE "a" DROP CONSTRAINT "a_b_fk";',
    );
  });

  it("renders DROP TYPE for an enum and DROP SCHEMA", () => {
    expect(emitDown([{ kind: "dropEnum", schema: "public", name: "role" }]).sql).toBe(
      'DROP TYPE "public"."role";',
    );
    expect(emitDown([{ kind: "dropSchema", name: "audit" }]).sql).toBe('DROP SCHEMA "audit";');
  });

  it("renders notNull/default reverts", () => {
    expect(emitDown([{ kind: "dropNotNull", schema: "", table: "u", column: "c" }]).sql).toBe(
      'ALTER TABLE "u" ALTER COLUMN "c" DROP NOT NULL;',
    );
    expect(emitDown([{ kind: "dropDefault", schema: "", table: "u", column: "c" }]).sql).toBe(
      'ALTER TABLE "u" ALTER COLUMN "c" DROP DEFAULT;',
    );
    expect(
      emitDown([{ kind: "setDefault", schema: "", table: "u", column: "c", value: "'x'" }]).sql,
    ).toBe(`ALTER TABLE "u" ALTER COLUMN "c" SET DEFAULT 'x';`);
  });

  it("recreates an index and an enum (restoring something the up dropped)", () => {
    const index = {
      name: "users_email_idx",
      columns: [{ expression: "email", isExpression: false, asc: true, nulls: "last" as const }],
      isUnique: true,
      concurrently: false,
      method: "btree",
      with: {},
    };
    expect(emitDown([{ kind: "createIndex", schema: "", table: "users", index }]).sql).toBe(
      'CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");',
    );
    expect(
      emitDown([{ kind: "createEnum", schema: "public", name: "role", values: ["A", "B"] }]).sql,
    ).toBe(`CREATE TYPE "public"."role" AS ENUM('A', 'B');`);
  });

  it("re-adds a removed enum value (with and without a position)", () => {
    expect(
      emitDown([{ kind: "addEnumValue", schema: "public", name: "role", value: "B", before: "C" }])
        .sql,
    ).toBe(`ALTER TYPE "public"."role" ADD VALUE 'B' BEFORE 'C';`);
    expect(
      emitDown([{ kind: "addEnumValue", schema: "public", name: "role", value: "B" }]).sql,
    ).toBe(`ALTER TYPE "public"."role" ADD VALUE 'B';`);
  });

  it("reverses a schema rename", () => {
    expect(emitDown([{ kind: "renameSchema", from: "logs", to: "audit" }]).sql).toBe(
      'ALTER SCHEMA "logs" RENAME TO "audit";',
    );
  });

  it("re-adds a foreign key the up dropped, with a -- verify: comment", () => {
    const fk = {
      name: "a_b_fk",
      tableFrom: "a",
      tableTo: "b",
      columnsFrom: ["b_id"],
      columnsTo: ["id"],
      onDelete: "cascade",
      onUpdate: "no action",
    };
    const { sql } = emitDown([{ kind: "addForeignKey", schema: "", table: "a", fk }]);
    expect(sql).toContain("-- verify:");
    expect(sql).toContain(
      'ALTER TABLE "a" ADD CONSTRAINT "a_b_fk" FOREIGN KEY ("b_id") REFERENCES "b" ("id") ON DELETE cascade ON UPDATE no action;',
    );
  });

  it("reverts a column type with a -- verify: comment", () => {
    const { sql } = emitDown([
      { kind: "alterColumnType", schema: "", table: "u", column: "id", toType: "uuid" },
    ]);
    expect(sql).toContain("-- verify:");
    expect(sql).toContain('ALTER TABLE "u" ALTER COLUMN "id" SET DATA TYPE uuid;');
  });

  it("joins multiple statements with Drizzle's breakpoint", () => {
    const { sql } = emitDown([
      { kind: "dropColumn", schema: "", table: "u", column: "a" },
      { kind: "dropColumn", schema: "", table: "u", column: "b" },
    ]);
    expect(sql).toBe(
      'ALTER TABLE "u" DROP COLUMN "a";\n--> statement-breakpoint\nALTER TABLE "u" DROP COLUMN "b";',
    );
  });

  it("orders drops before re-creates (drop FK before dropping its table)", () => {
    const ops: Operation[] = [
      { kind: "dropTable", schema: "", table: "a" },
      { kind: "dropForeignKey", schema: "", table: "b", name: "b_a_fk" },
    ];
    const { sql } = emitDown(ops);
    expect(sql.indexOf("DROP CONSTRAINT")).toBeLessThan(sql.indexOf("DROP TABLE"));
  });
});

describe("emitDown — lossy ops", () => {
  it("comments out a re-created dropped table and sets hasUnresolved", () => {
    const t = {
      name: "users",
      schema: "",
      columns: { id: { name: "id", type: "uuid", primaryKey: true, notNull: true } },
      indexes: {},
      foreignKeys: {},
      compositePrimaryKeys: {},
      uniqueConstraints: {},
    };
    const { sql, hasUnresolved } = emitDown([{ kind: "createTable", table: t }]);
    expect(hasUnresolved).toBe(true);
    expect(sql).toContain("WARNING: cannot auto-reverse DROP TABLE users");
    expect(sql).toContain('-- CREATE TABLE "users"');
  });

  it("comments out a re-added dropped column and sets hasUnresolved", () => {
    const { sql, hasUnresolved } = emitDown([
      {
        kind: "addColumn",
        schema: "",
        table: "users",
        column: { name: "email", type: "varchar(255)", primaryKey: false, notNull: false },
      },
    ]);
    expect(hasUnresolved).toBe(true);
    expect(sql).toContain('-- ALTER TABLE "users" ADD COLUMN "email" varchar(255);');
  });

  it("documents the enum-value-removal recipe and sets hasUnresolved", () => {
    const { sql, hasUnresolved } = emitDown([
      { kind: "enumValueRemovalUnsupported", schema: "public", name: "role", addedValues: ["B"] },
    ]);
    expect(hasUnresolved).toBe(true);
    expect(sql).toContain("Postgres cannot remove enum value(s) [B]");
  });

  it("a fully safe/verify migration has hasUnresolved=false", () => {
    const { hasUnresolved } = emitDown([
      { kind: "dropColumn", schema: "", table: "u", column: "a" },
      { kind: "setNotNull", schema: "", table: "u", column: "b" },
    ]);
    expect(hasUnresolved).toBe(false);
  });
});

describe("PostgresReverseBuilder", () => {
  it("writes STUB_MARKER only when hasUnresolved is true", async () => {
    const { PostgresReverseBuilder } = await import("../src/dialects/postgres/reverse.js");
    const builder = new PostgresReverseBuilder();
    const snap = (tables: Record<string, unknown>, enums = {}) =>
      ({
        version: "7",
        dialect: "postgresql",
        id: "x",
        prevId: "00000000-0000-0000-0000-000000000000",
        tables,
        enums,
        schemas: {},
        sequences: {},
      }) as unknown as Snapshot;

    // safe: up created a table -> down drops it -> no marker
    const safe = builder.buildReverse(
      null,
      snap({
        "public.u": {
          name: "u",
          schema: "",
          columns: { id: { name: "id", type: "uuid", primaryKey: true, notNull: true } },
          indexes: {},
          foreignKeys: {},
          compositePrimaryKeys: {},
          uniqueConstraints: {},
        },
      }),
    );
    expect(safe.hasUnresolved).toBe(false);
    expect(safe.sql).not.toContain(STUB_MARKER);
    expect(safe.sql).toContain('DROP TABLE "u";');

    // lossy: up dropped a table -> down re-creates it -> marker present
    const before = snap({
      "public.u": {
        name: "u",
        schema: "",
        columns: { id: { name: "id", type: "uuid", primaryKey: true, notNull: true } },
        indexes: {},
        foreignKeys: {},
        compositePrimaryKeys: {},
        uniqueConstraints: {},
      },
    });
    const after = snap({});
    after.prevId = before.id; // not the sentinel
    const lossy = builder.buildReverse(before, after);
    expect(lossy.hasUnresolved).toBe(true);
    expect(lossy.sql.startsWith(STUB_MARKER)).toBe(true);
  });
});

describe("emitDown — unsupported guard", () => {
  it("renders an unsupported op as a warning stub and sets hasUnresolved", () => {
    const { sql, hasUnresolved } = emitDown([{ kind: "unsupported", detail: "views changed" }]);
    expect(hasUnresolved).toBe(true);
    expect(sql).toContain("could not auto-reverse");
    expect(sql).toContain("views changed");
  });
});
