/** Default Drizzle migrations-tracking table name. */
export const DEFAULT_TABLE = "__drizzle_migrations";
/** Default Postgres schema that holds the tracking table. */
export const DEFAULT_SCHEMA = "drizzle";
/** Default migrations output folder if drizzle.config omits `out`. */
export const DEFAULT_OUT = "./drizzle";
/** Marker line written into generated stub .down.sql files; `check` fails while present. */
export const STUB_MARKER = "-- drizzle-rollback:stub";
/** Statement separator Drizzle writes into .sql files. */
export const BREAKPOINT = "--> statement-breakpoint";

/** Prefix for the informational comment placed before a "verify" (may-fail) statement. */
export const VERIFY_PREFIX = "-- verify:";
/** Drizzle's sentinel `prevId` for the very first snapshot (no predecessor). */
export const EMPTY_SNAPSHOT_ID = "00000000-0000-0000-0000-000000000000";
/** Snapshot `version` this engine understands. Other versions are rejected. */
export const SUPPORTED_SNAPSHOT_VERSION = "7";
/** Written into a down file when the snapshot pair is unavailable (forces hand-authoring). */
export const SNAPSHOT_MISSING_MARKER =
  "-- drizzle-rollback: snapshot for the previous state was not found; write this down by hand";
