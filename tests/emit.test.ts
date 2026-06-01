import { describe, expect, it } from "vitest";
import { emitDown } from "../src/dialects/postgres/emit.js";
import type { Operation } from "../src/diff/operations.js";

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
