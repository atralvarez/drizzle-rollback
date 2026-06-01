import type {
  Snapshot,
  SnapshotColumn,
  SnapshotCompositePk,
  SnapshotForeignKey,
  SnapshotIndex,
  SnapshotTable,
  SnapshotUnique,
} from "../snapshot/types.js";

/**
 * One reverse operation. `schema` is "" for the public schema.
 * "create*" / "add*" ops here mean: restore something the up DROPPED (often lossy).
 * "drop*" ops mean: undo something the up CREATED (mechanical).
 */
export type Operation =
  // tables
  | { kind: "dropTable"; schema: string; table: string }
  | { kind: "createTable"; table: SnapshotTable }
  // columns
  | { kind: "dropColumn"; schema: string; table: string; column: string }
  | { kind: "addColumn"; schema: string; table: string; column: SnapshotColumn }
  | {
      kind: "alterColumnType";
      schema: string;
      table: string;
      column: string;
      toType: string;
      typeSchema?: string;
    }
  | { kind: "setNotNull"; schema: string; table: string; column: string }
  | { kind: "dropNotNull"; schema: string; table: string; column: string }
  | {
      kind: "setDefault";
      schema: string;
      table: string;
      column: string;
      value: string | number | boolean;
    }
  | { kind: "dropDefault"; schema: string; table: string; column: string }
  // indexes
  | { kind: "createIndex"; schema: string; table: string; index: SnapshotIndex }
  | { kind: "dropIndex"; schema: string; name: string }
  // foreign keys
  | { kind: "addForeignKey"; schema: string; table: string; fk: SnapshotForeignKey }
  | { kind: "dropForeignKey"; schema: string; table: string; name: string }
  // unique + composite primary key constraints
  | { kind: "addUnique"; schema: string; table: string; unique: SnapshotUnique }
  | { kind: "dropUnique"; schema: string; table: string; name: string }
  | { kind: "addCompositePk"; schema: string; table: string; pk: SnapshotCompositePk }
  | { kind: "dropCompositePk"; schema: string; table: string; name: string }
  // enums (Postgres-specific)
  | { kind: "createEnum"; schema: string; name: string; values: string[] }
  | { kind: "dropEnum"; schema: string; name: string }
  | { kind: "enumValueRemovalUnsupported"; schema: string; name: string; addedValues: string[] }
  | { kind: "addEnumValue"; schema: string; name: string; value: string; before?: string }
  // schemas (Postgres-specific)
  | { kind: "createSchema"; name: string }
  | { kind: "dropSchema"; name: string }
  | { kind: "renameSchema"; from: string; to: string }
  // renames (from _meta)
  | { kind: "renameTable"; schema: string; from: string; to: string }
  | { kind: "renameColumn"; schema: string; table: string; from: string; to: string };

/** Result of building a reverse migration. */
export interface ReverseResult {
  ops: Operation[];
  sql: string;
  /** True if any op is data-losing / not expressible (a STUB_MARKER must be written). */
  hasUnresolved: boolean;
}

/** Pure seam: turn a snapshot pair into reverse SQL. Postgres impl in v0.2. */
export interface ReverseBuilder {
  buildReverse(prev: Snapshot | null, current: Snapshot): ReverseResult;
}
