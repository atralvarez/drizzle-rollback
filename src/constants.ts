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
