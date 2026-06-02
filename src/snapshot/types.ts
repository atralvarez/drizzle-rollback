/** A single column as stored in a Drizzle snapshot's `tables.<t>.columns`. */
export interface SnapshotColumn {
  name: string;
  type: string;
  primaryKey: boolean;
  notNull: boolean;
  /** Drizzle stores defaults SQL-ready: strings like "now()" or "'x'", or a number. */
  default?: string | number | boolean;
  /** Present when the column's type is an enum living in a non-default schema. */
  typeSchema?: string;
}

export interface SnapshotIndexColumn {
  expression: string;
  isExpression: boolean;
  asc: boolean;
  nulls?: "first" | "last";
}

export interface SnapshotIndex {
  name: string;
  columns: SnapshotIndexColumn[];
  isUnique: boolean;
  concurrently: boolean;
  method: string;
  with: Record<string, unknown>;
  where?: string;
}

export interface SnapshotForeignKey {
  name: string;
  tableFrom: string;
  tableTo: string;
  schemaTo?: string;
  columnsFrom: string[];
  columnsTo: string[];
  onDelete?: string;
  onUpdate?: string;
}

export interface SnapshotUnique {
  name: string;
  nullsNotDistinct: boolean;
  columns: string[];
}

export interface SnapshotCompositePk {
  name: string;
  columns: string[];
}

export interface SnapshotCheck {
  name: string;
  value: string;
}

export interface SnapshotTable {
  name: string;
  /** "" means the default (public) schema. */
  schema: string;
  columns: Record<string, SnapshotColumn>;
  indexes: Record<string, SnapshotIndex>;
  foreignKeys: Record<string, SnapshotForeignKey>;
  compositePrimaryKeys: Record<string, SnapshotCompositePk>;
  uniqueConstraints: Record<string, SnapshotUnique>;
  checkConstraints?: Record<string, SnapshotCheck>;
  policies?: Record<string, unknown>;
  isRLSEnabled?: boolean;
}

export interface SnapshotEnum {
  name: string;
  schema: string;
  values: string[];
}

/** Rename maps Drizzle persists at generation time, keyed as it resolved them. */
export interface SnapshotMeta {
  /** "schema.table.oldCol" -> "schema.table.newCol" */
  columns: Record<string, string>;
  /** "oldSchema" -> "newSchema" */
  schemas: Record<string, string>;
  /** "schema.oldTable" -> "schema.newTable" */
  tables: Record<string, string>;
}

/** A full Drizzle migration snapshot (the on-disk `meta/NNNN_snapshot.json`). */
export interface Snapshot {
  version: string;
  dialect: string;
  id: string;
  prevId: string;
  tables: Record<string, SnapshotTable>;
  enums: Record<string, SnapshotEnum>;
  schemas: Record<string, string>;
  sequences: Record<string, unknown>;
  policies?: Record<string, unknown>;
  views?: Record<string, unknown>;
  roles?: Record<string, unknown>;
  _meta?: SnapshotMeta;
}
