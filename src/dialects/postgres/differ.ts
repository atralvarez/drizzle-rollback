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

/** True if two snapshot sub-sections differ (used to flag sections we cannot auto-reverse). */
function sectionChanged(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
}

/**
 * Build the reverse operations to take the schema from `current` back to `prev`.
 * `prev = null` means the first migration (diff against an empty schema).
 */
export function diffReverse(prev: Snapshot | null, current: Snapshot): Operation[] {
  const before = prev ?? (EMPTY_SNAPSHOT as Snapshot);
  const meta = current._meta;
  const ops: Operation[] = [];

  // --- table renames (from _meta): reverse new -> old ---
  const renamedTableNewToOld = new Map<string, string>(); // current key -> before key
  const renamedTablesOldKey = new Set<string>();
  if (meta) {
    for (const [oldKey, newKey] of Object.entries(meta.tables)) {
      const cur = current.tables[newKey];
      const old = before.tables[oldKey];
      if (cur && old) {
        ops.push({ kind: "renameTable", schema: cur.schema, from: cur.name, to: old.name });
        renamedTableNewToOld.set(newKey, oldKey);
        renamedTablesOldKey.add(oldKey);
      }
    }
  }

  // --- column renames (from _meta) ---
  const renamedColsByTable = new Map<string, Map<string, string>>(); // current table key -> (newCol -> oldCol)
  if (meta) {
    for (const [oldKey, newKey] of Object.entries(meta.columns)) {
      const oldCol = oldKey.split(".").pop() as string;
      const newColParts = newKey.split(".");
      const newCol = newColParts.pop() as string;
      const tableKey = newColParts.join(".");
      const cur = current.tables[tableKey];
      if (!cur) continue;
      // Use the OLD table name: by the time column renames run, the table has been
      // renamed back to its previous name (renameTable ops are emitted first).
      const oldTableKey = renamedTableNewToOld.get(tableKey);
      const tableName = oldTableKey ? before.tables[oldTableKey].name : cur.name;
      ops.push({
        kind: "renameColumn",
        schema: cur.schema,
        table: tableName,
        from: newCol,
        to: oldCol,
      });
      const m = renamedColsByTable.get(tableKey) ?? new Map<string, string>();
      m.set(newCol, oldCol);
      renamedColsByTable.set(tableKey, m);
    }
  }

  // --- tables created by the up (in current, not before, not a rename) -> drop ---
  for (const [key, t] of Object.entries(current.tables)) {
    if (renamedTableNewToOld.has(key)) continue;
    if (!before.tables[key]) {
      ops.push({ kind: "dropTable", schema: t.schema, table: t.name });
    }
  }

  // --- tables dropped by the up (in before, not current, not a rename) -> re-create (lossy) ---
  for (const [key, t] of Object.entries(before.tables)) {
    if (renamedTablesOldKey.has(key)) continue;
    if (!current.tables[key]) {
      ops.push({ kind: "createTable", table: t });
    }
  }

  // --- tables present in both states (same key OR renamed) -> diff contents ---
  // For a renamed table, all column/constraint ops use the OLD table name, because the
  // down renames the table back to its previous name before these ops run.
  const tablePairs: Array<{ old: SnapshotTable; cur: SnapshotTable; curKey: string }> = [];
  for (const [key, cur] of Object.entries(current.tables)) {
    const oldKey = renamedTableNewToOld.get(key) ?? key;
    const old = before.tables[oldKey];
    if (old) tablePairs.push({ old, cur, curKey: key });
  }

  for (const { old, cur, curKey } of tablePairs) {
    const renames = renamedColsByTable.get(curKey) ?? new Map<string, string>();
    const tName = old.name;
    const tSchema = old.schema;

    // columns added by the up -> drop (skip renamed)
    for (const [colName, col] of Object.entries(cur.columns)) {
      if (renames.has(colName)) continue;
      if (!old.columns[colName]) {
        ops.push({ kind: "dropColumn", schema: tSchema, table: tName, column: col.name });
      }
    }
    // columns dropped by the up -> re-add from prev def (lossy) (skip renamed)
    for (const [colName, col] of Object.entries(old.columns)) {
      const wasRenamedTo = [...renames.values()].includes(colName);
      if (wasRenamedTo) continue;
      if (!cur.columns[colName]) {
        ops.push({ kind: "addColumn", schema: tSchema, table: tName, column: col });
      }
    }
    // columns in both -> attribute reverts (use the OLD column name for renamed columns)
    for (const [colName, curCol] of Object.entries(cur.columns)) {
      const oldName = renames.get(colName) ?? colName;
      const oldCol = old.columns[oldName];
      if (!oldCol) continue;
      if (curCol.type !== oldCol.type) {
        ops.push({
          kind: "alterColumnType",
          schema: tSchema,
          table: tName,
          column: oldName,
          toType: oldCol.type,
          typeSchema: oldCol.typeSchema,
        });
      }
      if (curCol.notNull !== oldCol.notNull) {
        ops.push(
          oldCol.notNull
            ? { kind: "setNotNull", schema: tSchema, table: tName, column: oldName }
            : { kind: "dropNotNull", schema: tSchema, table: tName, column: oldName },
        );
      }
      if (defOf(curCol) !== defOf(oldCol)) {
        ops.push(
          defOf(oldCol) === undefined
            ? { kind: "dropDefault", schema: tSchema, table: tName, column: oldName }
            : {
                kind: "setDefault",
                schema: tSchema,
                table: tName,
                column: oldName,
                value: defOf(oldCol) as string | number | boolean,
              },
        );
      }
    }

    // indexes
    for (const name of Object.keys(cur.indexes)) {
      if (!old.indexes[name]) ops.push({ kind: "dropIndex", schema: tSchema, name });
    }
    for (const [name, index] of Object.entries(old.indexes)) {
      if (!cur.indexes[name])
        ops.push({ kind: "createIndex", schema: tSchema, table: tName, index });
    }
    // foreign keys
    for (const name of Object.keys(cur.foreignKeys)) {
      if (!old.foreignKeys[name])
        ops.push({ kind: "dropForeignKey", schema: tSchema, table: tName, name });
    }
    for (const [name, fk] of Object.entries(old.foreignKeys)) {
      if (!cur.foreignKeys[name])
        ops.push({ kind: "addForeignKey", schema: tSchema, table: tName, fk });
    }
    // unique constraints
    for (const name of Object.keys(cur.uniqueConstraints)) {
      if (!old.uniqueConstraints[name])
        ops.push({ kind: "dropUnique", schema: tSchema, table: tName, name });
    }
    for (const [name, unique] of Object.entries(old.uniqueConstraints)) {
      if (!cur.uniqueConstraints[name])
        ops.push({ kind: "addUnique", schema: tSchema, table: tName, unique });
    }
    // composite primary keys
    for (const name of Object.keys(cur.compositePrimaryKeys)) {
      if (!old.compositePrimaryKeys[name])
        ops.push({ kind: "dropCompositePk", schema: tSchema, table: tName, name });
    }
    for (const [name, pk] of Object.entries(old.compositePrimaryKeys)) {
      if (!cur.compositePrimaryKeys[name])
        ops.push({ kind: "addCompositePk", schema: tSchema, table: tName, pk });
    }

    // Sections we do not auto-reverse yet: flag any change so `check` fails (no silent gap).
    const tableLabel = tSchema ? `"${tSchema}"."${tName}"` : `"${tName}"`;
    if (sectionChanged(cur.checkConstraints, old.checkConstraints)) {
      ops.push({ kind: "unsupported", detail: `check constraints changed on table ${tableLabel}` });
    }
    if (sectionChanged(cur.policies, old.policies)) {
      ops.push({
        kind: "unsupported",
        detail: `row-level security policies changed on table ${tableLabel}`,
      });
    }
    if ((cur.isRLSEnabled ?? false) !== (old.isRLSEnabled ?? false)) {
      ops.push({
        kind: "unsupported",
        detail: `row-level security enablement changed on table ${tableLabel}`,
      });
    }
  }

  // --- enums ---
  for (const [key, e] of Object.entries(current.enums)) {
    const old = before.enums[key];
    if (!old) {
      ops.push({ kind: "dropEnum", schema: e.schema, name: e.name });
      continue;
    }
    // values added by the up -> cannot remove them in reverse (Postgres limitation)
    const added = e.values.filter((v) => !old.values.includes(v));
    if (added.length > 0) {
      ops.push({
        kind: "enumValueRemovalUnsupported",
        schema: e.schema,
        name: e.name,
        addedValues: added,
      });
    }
    // values removed by the up -> re-add in reverse (safe: ALTER TYPE ADD VALUE)
    for (let i = 0; i < old.values.length; i++) {
      const value = old.values[i];
      if (e.values.includes(value)) continue;
      // restore position: place before the first later prev-value that still exists
      let beforeValue: string | undefined;
      for (let j = i + 1; j < old.values.length; j++) {
        if (e.values.includes(old.values[j])) {
          beforeValue = old.values[j];
          break;
        }
      }
      ops.push({
        kind: "addEnumValue",
        schema: e.schema,
        name: e.name,
        value,
        before: beforeValue,
      });
    }
  }
  for (const [key, e] of Object.entries(before.enums)) {
    if (!current.enums[key])
      ops.push({ kind: "createEnum", schema: e.schema, name: e.name, values: e.values });
  }

  // --- schema renames (from _meta): reverse new -> old ---
  const renamedSchemaNew = new Set<string>();
  const renamedSchemaOld = new Set<string>();
  if (meta) {
    for (const [oldName, newName] of Object.entries(meta.schemas)) {
      ops.push({ kind: "renameSchema", from: newName, to: oldName });
      renamedSchemaNew.add(newName);
      renamedSchemaOld.add(oldName);
    }
  }
  // --- schemas created/dropped by the up (excluding renames) ---
  for (const name of Object.keys(current.schemas)) {
    if (renamedSchemaNew.has(name)) continue;
    if (!before.schemas[name]) ops.push({ kind: "dropSchema", name });
  }
  for (const name of Object.keys(before.schemas)) {
    if (renamedSchemaOld.has(name)) continue;
    if (!current.schemas[name]) ops.push({ kind: "createSchema", name });
  }

  // Top-level sections we do not auto-reverse yet.
  if (sectionChanged(current.sequences, before.sequences)) {
    ops.push({ kind: "unsupported", detail: "sequences changed" });
  }
  if (sectionChanged(current.policies, before.policies)) {
    ops.push({ kind: "unsupported", detail: "top-level policies changed" });
  }
  if (sectionChanged(current.views, before.views)) {
    ops.push({ kind: "unsupported", detail: "views changed" });
  }
  if (sectionChanged(current.roles, before.roles)) {
    ops.push({ kind: "unsupported", detail: "roles changed" });
  }

  return ops;
}
