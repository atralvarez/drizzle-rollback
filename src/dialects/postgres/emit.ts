import { BREAKPOINT, VERIFY_PREFIX } from "../../constants.js";
import { tierOf } from "../../diff/classify.js";
import type { Operation } from "../../diff/operations.js";
import type {
  SnapshotColumn,
  SnapshotForeignKey,
  SnapshotIndex,
  SnapshotTable,
} from "../../snapshot/types.js";

const q = (id: string): string => `"${id.replace(/"/g, '""')}"`;
/** A single-quoted SQL string literal with embedded quotes escaped. */
const lit = (s: string): string => `'${s.replace(/'/g, "''")}'`;
/** Qualify a name with its schema; "" means the default (public) schema. */
const qScoped = (schema: string, name: string): string =>
  schema ? `${q(schema)}.${q(name)}` : q(name);
const cols = (names: string[]): string => names.map(q).join(", ");

function renderType(type: string, typeSchema?: string): string {
  return typeSchema ? `${q(typeSchema)}.${q(type)}` : type;
}
function renderDefault(value: string | number | boolean): string {
  return typeof value === "string" ? value : String(value);
}
function columnDef(c: SnapshotColumn): string {
  let def = `${q(c.name)} ${renderType(c.type, c.typeSchema)}`;
  if (c.default !== undefined) def += ` DEFAULT ${renderDefault(c.default)}`;
  if (c.primaryKey) def += " PRIMARY KEY";
  if (c.notNull) def += " NOT NULL";
  return def;
}
function indexColumn(col: SnapshotIndex["columns"][number]): string {
  const base = col.isExpression ? col.expression : q(col.expression);
  const dir = col.asc ? "" : " DESC";
  // Postgres default null ordering: ASC -> NULLS LAST, DESC -> NULLS FIRST. Only emit when it deviates.
  const defaultNulls = col.asc ? "last" : "first";
  const nulls = col.nulls && col.nulls !== defaultNulls ? ` NULLS ${col.nulls.toUpperCase()}` : "";
  return `${base}${dir}${nulls}`;
}
function createTable(t: SnapshotTable): string {
  const lines = Object.values(t.columns).map(columnDef);
  return `CREATE TABLE ${qScoped(t.schema, t.name)} (\n\t${lines.join(",\n\t")}\n);`;
}
function indexWith(withClause: SnapshotIndex["with"]): string {
  const entries = Object.entries(withClause ?? {});
  if (entries.length === 0) return "";
  return ` WITH (${entries.map(([k, v]) => `${k} = ${v}`).join(", ")})`;
}
function createIndex(schema: string, table: string, ix: SnapshotIndex): string {
  const unique = ix.isUnique ? "UNIQUE " : "";
  const list = ix.columns.map(indexColumn).join(", ");
  const where = ix.where ? ` WHERE ${ix.where}` : "";
  return `CREATE ${unique}INDEX ${q(ix.name)} ON ${qScoped(schema, table)} USING ${ix.method} (${list})${indexWith(ix.with)}${where};`;
}
function addForeignKey(schema: string, table: string, fk: SnapshotForeignKey): string {
  const ref = qScoped(fk.schemaTo ?? "", fk.tableTo);
  const onDelete = fk.onDelete ? ` ON DELETE ${fk.onDelete}` : "";
  const onUpdate = fk.onUpdate ? ` ON UPDATE ${fk.onUpdate}` : "";
  return `ALTER TABLE ${qScoped(schema, table)} ADD CONSTRAINT ${q(fk.name)} FOREIGN KEY (${cols(fk.columnsFrom)}) REFERENCES ${ref} (${cols(fk.columnsTo)})${onDelete}${onUpdate};`;
}

/** Lower number = emitted earlier. Mirrors the reverse of Drizzle's forward apply order. */
function phaseOf(op: Operation): number {
  switch (op.kind) {
    case "renameTable":
    case "renameColumn":
    case "renameSchema":
      return 0;
    case "dropForeignKey":
      return 1;
    case "dropIndex":
      return 2;
    case "dropUnique":
    case "dropCompositePk":
      return 3;
    case "alterColumnType":
    case "setNotNull":
    case "dropNotNull":
    case "setDefault":
    case "dropDefault":
      return 4;
    case "dropColumn":
      return 5;
    case "dropTable":
      return 6;
    case "dropEnum":
      return 7;
    case "dropSchema":
      return 8;
    case "createSchema":
      return 9;
    case "createEnum":
    case "addEnumValue":
      return 10;
    case "createTable":
      return 11;
    case "addColumn":
      return 12;
    case "addCompositePk":
    case "addUnique":
      return 13;
    case "createIndex":
      return 14;
    case "addForeignKey":
      return 15;
    case "enumValueRemovalUnsupported":
      return 16;
    case "unsupported":
      return 17;
  }
}

/** Render one operation's SQL body (without comment/stub wrapping). */
function renderOp(op: Operation): string {
  switch (op.kind) {
    case "renameTable":
      return `ALTER TABLE ${qScoped(op.schema, op.from)} RENAME TO ${q(op.to)};`;
    case "renameColumn":
      return `ALTER TABLE ${qScoped(op.schema, op.table)} RENAME COLUMN ${q(op.from)} TO ${q(op.to)};`;
    case "renameSchema":
      return `ALTER SCHEMA ${q(op.from)} RENAME TO ${q(op.to)};`;
    case "dropTable":
      return `DROP TABLE ${qScoped(op.schema, op.table)};`;
    case "createTable":
      return createTable(op.table);
    case "dropColumn":
      return `ALTER TABLE ${qScoped(op.schema, op.table)} DROP COLUMN ${q(op.column)};`;
    case "addColumn":
      return `ALTER TABLE ${qScoped(op.schema, op.table)} ADD COLUMN ${columnDef(op.column)};`;
    case "alterColumnType":
      return `ALTER TABLE ${qScoped(op.schema, op.table)} ALTER COLUMN ${q(op.column)} SET DATA TYPE ${renderType(op.toType, op.typeSchema)};`;
    case "setNotNull":
      return `ALTER TABLE ${qScoped(op.schema, op.table)} ALTER COLUMN ${q(op.column)} SET NOT NULL;`;
    case "dropNotNull":
      return `ALTER TABLE ${qScoped(op.schema, op.table)} ALTER COLUMN ${q(op.column)} DROP NOT NULL;`;
    case "setDefault":
      return `ALTER TABLE ${qScoped(op.schema, op.table)} ALTER COLUMN ${q(op.column)} SET DEFAULT ${renderDefault(op.value)};`;
    case "dropDefault":
      return `ALTER TABLE ${qScoped(op.schema, op.table)} ALTER COLUMN ${q(op.column)} DROP DEFAULT;`;
    case "createIndex":
      return createIndex(op.schema, op.table, op.index);
    case "dropIndex":
      return `DROP INDEX ${qScoped(op.schema, op.name)};`;
    case "addForeignKey":
      return addForeignKey(op.schema, op.table, op.fk);
    case "dropForeignKey":
      return `ALTER TABLE ${qScoped(op.schema, op.table)} DROP CONSTRAINT ${q(op.name)};`;
    case "addUnique":
      return `ALTER TABLE ${qScoped(op.schema, op.table)} ADD CONSTRAINT ${q(op.unique.name)} UNIQUE${op.unique.nullsNotDistinct ? " NULLS NOT DISTINCT" : ""} (${cols(op.unique.columns)});`;
    case "dropUnique":
      return `ALTER TABLE ${qScoped(op.schema, op.table)} DROP CONSTRAINT ${q(op.name)};`;
    case "addCompositePk":
      return `ALTER TABLE ${qScoped(op.schema, op.table)} ADD CONSTRAINT ${q(op.pk.name)} PRIMARY KEY (${cols(op.pk.columns)});`;
    case "dropCompositePk":
      return `ALTER TABLE ${qScoped(op.schema, op.table)} DROP CONSTRAINT ${q(op.name)};`;
    case "createEnum":
      return `CREATE TYPE ${qScoped(op.schema, op.name)} AS ENUM(${op.values.map(lit).join(", ")});`;
    case "addEnumValue":
      return `ALTER TYPE ${qScoped(op.schema, op.name)} ADD VALUE ${lit(op.value)}${op.before ? ` BEFORE ${lit(op.before)}` : ""};`;
    case "dropEnum":
      return `DROP TYPE ${qScoped(op.schema, op.name)};`;
    case "createSchema":
      return `CREATE SCHEMA ${q(op.name)};`;
    case "dropSchema":
      return `DROP SCHEMA ${q(op.name)};`;
    case "enumValueRemovalUnsupported":
      return ""; // handled as a lossy stub block
    case "unsupported":
      return ""; // handled as a lossy stub block
  }
}

/** Comment out every line of a block (for lossy stubs). */
function commentOut(text: string): string {
  return text
    .split("\n")
    .map((line) => `-- ${line}`)
    .join("\n");
}

/** Build the explanatory stub block for a lossy op. */
function lossyBlock(op: Operation): string {
  if (op.kind === "createTable") {
    return `-- WARNING: cannot auto-reverse DROP TABLE ${op.table.name} without data loss.\n-- Structure below is restorable; the original rows are NOT. Uncomment only if acceptable:\n${commentOut(renderOp(op))}`;
  }
  if (op.kind === "addColumn") {
    return `-- WARNING: cannot auto-reverse DROP COLUMN ${op.table}.${op.column.name} without data loss.\n-- Structure below is restorable; the original values are NOT. Uncomment only if acceptable:\n${commentOut(renderOp(op))}`;
  }
  if (op.kind === "enumValueRemovalUnsupported") {
    return `-- WARNING: Postgres cannot remove enum value(s) [${op.addedValues.join(", ")}] from ${op.schema}.${op.name} with simple DDL.\n-- Recipe (write by hand if needed): create a new type without the value, swap dependent columns to it, drop the old type, rename.`;
  }
  if (op.kind === "unsupported") {
    return `-- WARNING: drizzle-rollback could not auto-reverse the following change(s); write the reverse by hand:\n-- ${op.detail}`;
  }
  return commentOut(renderOp(op));
}

/**
 * Render reverse operations to a single .down.sql body.
 * `hasUnresolved` is true when any lossy op is present (the caller writes STUB_MARKER).
 */
export function emitDown(ops: Operation[]): { sql: string; hasUnresolved: boolean } {
  const ordered = ops
    .map((op, i) => ({ op, i }))
    .sort((a, b) => phaseOf(a.op) - phaseOf(b.op) || a.i - b.i)
    .map((x) => x.op);

  let hasUnresolved = false;
  const blocks: string[] = [];
  for (const op of ordered) {
    const tier = tierOf(op);
    if (tier === "lossy") {
      hasUnresolved = true;
      blocks.push(lossyBlock(op));
    } else if (tier === "verify") {
      blocks.push(
        `${VERIFY_PREFIX} this statement may fail or alter data against the current database — review before running.\n${renderOp(op)}`,
      );
    } else {
      blocks.push(renderOp(op));
    }
  }

  return { sql: blocks.join(`\n${BREAKPOINT}\n`), hasUnresolved };
}
