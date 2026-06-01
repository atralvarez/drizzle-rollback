import type { Operation } from "../../diff/operations.js";
import type { Snapshot, SnapshotColumn, SnapshotTable } from "../../snapshot/types.js";

const EMPTY_SNAPSHOT: Pick<Snapshot, "tables" | "enums" | "schemas" | "sequences"> = {
  tables: {},
  enums: {},
  schemas: {},
  sequences: {},
};

function defOf(c: SnapshotColumn): string | number | boolean | undefined {
  return c.default;
}

/**
 * Build the reverse operations to take the schema from `current` back to `prev`.
 * `prev = null` means the first migration (diff against an empty schema).
 */
export function diffReverse(prev: Snapshot | null, current: Snapshot): Operation[] {
  const before = prev ?? (EMPTY_SNAPSHOT as Snapshot);
  const meta = current._meta;
  const ops: Operation[] = [];

  // --- renames (from _meta): reverse new -> old, skip in add/drop detection ---
  const renamedTablesNewKey = new Set<string>();
  const renamedTablesOldKey = new Set<string>();
  if (meta) {
    for (const [oldKey, newKey] of Object.entries(meta.tables)) {
      const cur = current.tables[newKey];
      const old = before.tables[oldKey];
      if (cur && old) {
        ops.push({ kind: "renameTable", schema: cur.schema, from: cur.name, to: old.name });
        renamedTablesNewKey.add(newKey);
        renamedTablesOldKey.add(oldKey);
      }
    }
  }

  const renamedColsByTable = new Map<string, Map<string, string>>();
  if (meta) {
    for (const [oldKey, newKey] of Object.entries(meta.columns)) {
      const oldCol = oldKey.split(".").pop() as string;
      const newColParts = newKey.split(".");
      const newCol = newColParts.pop() as string;
      const tableKey = newColParts.join(".");
      const cur = current.tables[tableKey];
      if (!cur) continue;
      ops.push({
        kind: "renameColumn",
        schema: cur.schema,
        table: cur.name,
        from: newCol,
        to: oldCol,
      });
      const m = renamedColsByTable.get(tableKey) ?? new Map<string, string>();
      m.set(newCol, oldCol);
      renamedColsByTable.set(tableKey, m);
    }
  }

  // --- tables created by the up (in current, not before) -> drop ---
  for (const [key, t] of Object.entries(current.tables)) {
    if (renamedTablesNewKey.has(key)) continue;
    if (!before.tables[key]) {
      ops.push({ kind: "dropTable", schema: t.schema, table: t.name });
    }
  }

  // --- tables dropped by the up (in before, not current) -> re-create (lossy) ---
  for (const [key, t] of Object.entries(before.tables)) {
    if (renamedTablesOldKey.has(key)) continue;
    if (!current.tables[key]) {
      ops.push({ kind: "createTable", table: t });
    }
  }

  // --- tables in both -> diff columns (extended in Task 5 for indexes/fks/constraints/enums) ---
  for (const [key, cur] of Object.entries(current.tables)) {
    const old = before.tables[key];
    if (!old) continue;
    const renames = renamedColsByTable.get(key) ?? new Map<string, string>();

    // columns added by the up -> drop (skip renamed)
    for (const [colName, col] of Object.entries(cur.columns)) {
      if (renames.has(colName)) continue;
      if (!old.columns[colName]) {
        ops.push({ kind: "dropColumn", schema: cur.schema, table: cur.name, column: col.name });
      }
    }

    // columns dropped by the up -> re-add from prev def (lossy)
    for (const [colName, col] of Object.entries(old.columns)) {
      const wasRenamedTo = [...renames.values()].some((oldC) => oldC === colName);
      if (wasRenamedTo) continue;
      if (!cur.columns[colName]) {
        ops.push({ kind: "addColumn", schema: cur.schema, table: cur.name, column: col });
      }
    }

    // columns in both -> attribute reverts
    for (const [colName, curCol] of Object.entries(cur.columns)) {
      const oldCol = old.columns[colName];
      if (!oldCol) continue;

      if (curCol.type !== oldCol.type) {
        ops.push({
          kind: "alterColumnType",
          schema: cur.schema,
          table: cur.name,
          column: colName,
          toType: oldCol.type,
          typeSchema: oldCol.typeSchema,
        });
      }

      if (curCol.notNull !== oldCol.notNull) {
        ops.push(
          oldCol.notNull
            ? { kind: "setNotNull", schema: cur.schema, table: cur.name, column: colName }
            : { kind: "dropNotNull", schema: cur.schema, table: cur.name, column: colName },
        );
      }

      if (defOf(curCol) !== defOf(oldCol)) {
        ops.push(
          defOf(oldCol) === undefined
            ? { kind: "dropDefault", schema: cur.schema, table: cur.name, column: colName }
            : {
                kind: "setDefault",
                schema: cur.schema,
                table: cur.name,
                column: colName,
                value: defOf(oldCol) as string | number | boolean,
              },
        );
      }
    }
  }

  return ops;
}
