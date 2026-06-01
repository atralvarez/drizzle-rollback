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
