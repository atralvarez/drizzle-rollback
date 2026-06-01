import { describe, expect, it } from "vitest";
import { diffReverse } from "../src/dialects/postgres/differ.js";
import type { Snapshot, SnapshotTable } from "../src/snapshot/types.js";

function table(name: string, columns: SnapshotTable["columns"]): SnapshotTable {
  return {
    name,
    schema: "",
    columns,
    indexes: {},
    foreignKeys: {},
    compositePrimaryKeys: {},
    uniqueConstraints: {},
  };
}
function snap(tables: Record<string, SnapshotTable>, extra: Partial<Snapshot> = {}): Snapshot {
  return {
    version: "7",
    dialect: "postgresql",
    id: "x",
    prevId: "y",
    tables,
    enums: {},
    schemas: {},
    sequences: {},
    ...extra,
  };
}
const col = (name: string, type: string, over = {}) => ({
  name,
  type,
  primaryKey: false,
  notNull: false,
  ...over,
});

describe("diffReverse — tables & columns", () => {
  it("up created a table -> down drops it", () => {
    const prev = snap({});
    const current = snap({ "public.users": table("users", { id: col("id", "uuid") }) });

    expect(diffReverse(prev, current)).toEqual([{ kind: "dropTable", schema: "", table: "users" }]);
  });

  it("first migration (prev=null) drops everything created", () => {
    const current = snap({ "public.users": table("users", { id: col("id", "uuid") }) });
    expect(diffReverse(null, current)).toEqual([{ kind: "dropTable", schema: "", table: "users" }]);
  });

  it("up dropped a table -> down re-creates it (lossy)", () => {
    const t = table("users", { id: col("id", "uuid") });
    expect(diffReverse(snap({ "public.users": t }), snap({}))).toEqual([
      { kind: "createTable", table: t },
    ]);
  });

  it("up added a column -> down drops it", () => {
    const prev = snap({ "public.users": table("users", { id: col("id", "uuid") }) });
    const current = snap({
      "public.users": table("users", {
        id: col("id", "uuid"),
        email: col("email", "varchar(255)"),
      }),
    });

    expect(diffReverse(prev, current)).toEqual([
      { kind: "dropColumn", schema: "", table: "users", column: "email" },
    ]);
  });

  it("up dropped a column -> down re-adds it (lossy)", () => {
    const prev = snap({
      "public.users": table("users", {
        id: col("id", "uuid"),
        email: col("email", "varchar(255)"),
      }),
    });
    const current = snap({ "public.users": table("users", { id: col("id", "uuid") }) });

    expect(diffReverse(prev, current)).toEqual([
      { kind: "addColumn", schema: "", table: "users", column: col("email", "varchar(255)") },
    ]);
  });

  it("up changed a column type -> down reverts to the previous type", () => {
    const prev = snap({ "public.users": table("users", { id: col("id", "uuid") }) });
    const current = snap({ "public.users": table("users", { id: col("id", "text") }) });

    expect(diffReverse(prev, current)).toEqual([
      {
        kind: "alterColumnType",
        schema: "",
        table: "users",
        column: "id",
        toType: "uuid",
        typeSchema: undefined,
      },
    ]);
  });

  it("up toggled notNull/default -> down reverts each", () => {
    const prev = snap({
      "public.users": table("users", { c: col("c", "text", { notNull: false }) }),
    });
    const current = snap({
      "public.users": table("users", { c: col("c", "text", { notNull: true, default: "'x'" }) }),
    });

    const ops = diffReverse(prev, current);
    expect(ops).toContainEqual({ kind: "dropNotNull", schema: "", table: "users", column: "c" });
    expect(ops).toContainEqual({ kind: "dropDefault", schema: "", table: "users", column: "c" });
  });

  it("treats a renamed column from _meta as a reverse rename, not drop+add", () => {
    const prev = snap({ "public.users": table("users", { name: col("name", "text") }) });
    const current = snap(
      { "public.users": table("users", { full_name: col("full_name", "text") }) },
      {
        _meta: {
          columns: { "public.users.name": "public.users.full_name" },
          schemas: {},
          tables: {},
        },
      },
    );

    expect(diffReverse(prev, current)).toEqual([
      { kind: "renameColumn", schema: "", table: "users", from: "full_name", to: "name" },
    ]);
  });

  it("treats a renamed table from _meta as a reverse rename", () => {
    const prev = snap({ "public.members": table("members", { id: col("id", "uuid") }) });
    const current = snap(
      { "public.users": table("users", { id: col("id", "uuid") }) },
      { _meta: { columns: {}, schemas: {}, tables: { "public.members": "public.users" } } },
    );

    expect(diffReverse(prev, current)).toEqual([
      { kind: "renameTable", schema: "", from: "users", to: "members" },
    ]);
  });
});

describe("diffReverse — indexes, fks, constraints, enums, schemas", () => {
  const enumSnap = (
    enums: Record<string, { name: string; schema: string; values: string[] }>,
    tables = {},
  ) => snap(tables, { enums });

  it("up created an index -> down drops it; up dropped an index -> down recreates it", () => {
    const idx = {
      name: "users_email_idx",
      columns: [{ expression: "email", isExpression: false, asc: true, nulls: "last" as const }],
      isUnique: false,
      concurrently: false,
      method: "btree",
      with: {},
    };
    const withIdx = {
      ...table("users", { email: col("email", "text") }),
      indexes: { users_email_idx: idx },
    };
    const without = table("users", { email: col("email", "text") });

    expect(
      diffReverse(snap({ "public.users": without }), snap({ "public.users": withIdx })),
    ).toContainEqual({ kind: "dropIndex", schema: "", name: "users_email_idx" });
    expect(
      diffReverse(snap({ "public.users": withIdx }), snap({ "public.users": without })),
    ).toContainEqual({ kind: "createIndex", schema: "", table: "users", index: idx });
  });

  it("up added a foreign key -> down drops it; up dropped one -> down re-adds it", () => {
    const fk = {
      name: "a_b_fk",
      tableFrom: "a",
      tableTo: "b",
      columnsFrom: ["b_id"],
      columnsTo: ["id"],
      onDelete: "cascade",
      onUpdate: "no action",
    };
    const withFk = { ...table("a", { b_id: col("b_id", "uuid") }), foreignKeys: { a_b_fk: fk } };
    const without = table("a", { b_id: col("b_id", "uuid") });

    expect(diffReverse(snap({ "public.a": without }), snap({ "public.a": withFk }))).toContainEqual(
      { kind: "dropForeignKey", schema: "", table: "a", name: "a_b_fk" },
    );
    expect(diffReverse(snap({ "public.a": withFk }), snap({ "public.a": without }))).toContainEqual(
      { kind: "addForeignKey", schema: "", table: "a", fk },
    );
  });

  it("up added a unique constraint -> down drops it", () => {
    const uniq = { name: "u_slug", nullsNotDistinct: false, columns: ["slug"] };
    const withU = {
      ...table("o", { slug: col("slug", "text") }),
      uniqueConstraints: { u_slug: uniq },
    };
    const without = table("o", { slug: col("slug", "text") });
    expect(diffReverse(snap({ "public.o": without }), snap({ "public.o": withU }))).toContainEqual({
      kind: "dropUnique",
      schema: "",
      table: "o",
      name: "u_slug",
    });
  });

  it("up added a composite primary key -> down drops it", () => {
    const pk = { name: "c_pk", columns: ["a", "b"] };
    const withPk = {
      ...table("c", { a: col("a", "int"), b: col("b", "int") }),
      compositePrimaryKeys: { c_pk: pk },
    };
    const without = table("c", { a: col("a", "int"), b: col("b", "int") });
    expect(diffReverse(snap({ "public.c": without }), snap({ "public.c": withPk }))).toContainEqual(
      { kind: "dropCompositePk", schema: "", table: "c", name: "c_pk" },
    );
  });

  it("up created an enum -> down drops it; up dropped an enum -> down recreates it", () => {
    const e = { "public.role": { name: "role", schema: "public", values: ["A", "B"] } };
    expect(diffReverse(enumSnap({}), enumSnap(e))).toContainEqual({
      kind: "dropEnum",
      schema: "public",
      name: "role",
    });
    expect(diffReverse(enumSnap(e), enumSnap({}))).toContainEqual({
      kind: "createEnum",
      schema: "public",
      name: "role",
      values: ["A", "B"],
    });
  });

  it("up added a value to an enum -> down marks it unsupported (lossy)", () => {
    const prev = enumSnap({ "public.role": { name: "role", schema: "public", values: ["A"] } });
    const current = enumSnap({
      "public.role": { name: "role", schema: "public", values: ["A", "B"] },
    });
    expect(diffReverse(prev, current)).toContainEqual({
      kind: "enumValueRemovalUnsupported",
      schema: "public",
      name: "role",
      addedValues: ["B"],
    });
  });

  it("up created a schema -> down drops it", () => {
    expect(
      diffReverse(snap({}, { schemas: {} }), snap({}, { schemas: { audit: "audit" } })),
    ).toContainEqual({ kind: "dropSchema", name: "audit" });
  });
});

describe("diffReverse — review-found edge cases", () => {
  const enumValuesSnap = (values: string[]) =>
    snap({}, { enums: { "public.role": { name: "role", schema: "public", values } } });

  it("up removed an enum value -> down re-adds it before the surviving successor", () => {
    const ops = diffReverse(enumValuesSnap(["A", "B", "C"]), enumValuesSnap(["A", "C"]));
    expect(ops).toContainEqual({
      kind: "addEnumValue",
      schema: "public",
      name: "role",
      value: "B",
      before: "C",
    });
  });

  it("appends a re-added enum value when it was last in the previous order", () => {
    const ops = diffReverse(enumValuesSnap(["A", "B"]), enumValuesSnap(["A"]));
    expect(ops).toContainEqual({
      kind: "addEnumValue",
      schema: "public",
      name: "role",
      value: "B",
      before: undefined,
    });
  });

  it("reverts column attributes on a renamed table using the old table name", () => {
    const prev = snap({
      "public.members": table("members", { age: col("age", "int", { notNull: false }) }),
    });
    const current = snap(
      { "public.users": table("users", { age: col("age", "int", { notNull: true }) }) },
      { _meta: { columns: {}, schemas: {}, tables: { "public.members": "public.users" } } },
    );
    const ops = diffReverse(prev, current);
    expect(ops).toContainEqual({ kind: "renameTable", schema: "", from: "users", to: "members" });
    expect(ops).toContainEqual({
      kind: "dropNotNull",
      schema: "",
      table: "members",
      column: "age",
    });
  });

  it("when table and column are both renamed, the column rename targets the old table name", () => {
    const prev = snap({ "public.members": table("members", { name: col("name", "text") }) });
    const current = snap(
      { "public.users": table("users", { full_name: col("full_name", "text") }) },
      {
        _meta: {
          columns: { "public.members.name": "public.users.full_name" },
          schemas: {},
          tables: { "public.members": "public.users" },
        },
      },
    );
    const ops = diffReverse(prev, current);
    expect(ops).toContainEqual({ kind: "renameTable", schema: "", from: "users", to: "members" });
    expect(ops).toContainEqual({
      kind: "renameColumn",
      schema: "",
      table: "members",
      from: "full_name",
      to: "name",
    });
  });

  it("reverses a schema rename instead of dropping it", () => {
    const prev = snap({}, { schemas: { audit: "audit" } });
    const current = snap(
      {},
      { schemas: { logs: "logs" }, _meta: { columns: {}, schemas: { audit: "logs" }, tables: {} } },
    );
    const ops = diffReverse(prev, current);
    expect(ops).toContainEqual({ kind: "renameSchema", from: "logs", to: "audit" });
    expect(ops).not.toContainEqual({ kind: "dropSchema", name: "logs" });
    expect(ops).not.toContainEqual({ kind: "createSchema", name: "audit" });
  });
});
