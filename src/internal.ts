/**
 * Unstable engine internals, exposed via `drizzle-rollback/internal`.
 *
 * NOT covered by semver — anything here may change or be removed in any release.
 * For the stable API, import from the package root (`drizzle-rollback`).
 */
export { loadSnapshots } from "./snapshot/loader.js";
export type { LoadedSnapshots, SnapshotPair } from "./snapshot/loader.js";
export { diffReverse } from "./dialects/postgres/differ.js";
export { emitDown } from "./dialects/postgres/emit.js";
export { PostgresReverseBuilder } from "./dialects/postgres/reverse.js";
export type { Operation, ReverseBuilder, ReverseResult } from "./diff/operations.js";
export { tierOf } from "./diff/classify.js";
export type { Tier } from "./diff/classify.js";
export type { Snapshot, SnapshotTable, SnapshotColumn } from "./snapshot/types.js";
