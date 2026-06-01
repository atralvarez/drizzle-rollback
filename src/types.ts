/** Postgres connection input as found in drizzle.config `dbCredentials`. */
export type PgCredentials =
  | { url: string }
  | {
      host: string;
      port?: number;
      user?: string;
      password?: string;
      database: string;
      ssl?: boolean | object;
    };

/** Fully-resolved configuration derived from the user's drizzle.config. */
export interface ResolvedConfig {
  dialect: "postgresql";
  /** Absolute path to the migrations output folder. */
  out: string;
  migrationsTable: string;
  migrationsSchema: string;
  dbCredentials: PgCredentials;
}

/** One migration as present on disk (from the journal + .sql file). */
export interface MigrationFile {
  idx: number;
  tag: string;
  /** Journal `when` timestamp (ms); equals the row's `created_at`. */
  when: number;
  upPath: string;
  downPath: string;
  /** SHA-256 hex of the full up .sql file content — matches the tracking row hash. */
  hash: string;
  hasDown: boolean;
}

/** One row of the tracking table. */
export interface AppliedMigration {
  id: number;
  hash: string;
  createdAt: number;
}

/** DB-specific operations. v0.1 implements Postgres only. */
export interface Dialect {
  /** Applied migrations, ordered oldest-first. */
  getApplied(): Promise<AppliedMigration[]>;
  /**
   * Run `downSql` and delete the tracking row in a single transaction.
   * Rolls back and throws if any statement fails.
   */
  revertOne(downSql: string, row: AppliedMigration): Promise<void>;
  close(): Promise<void>;
}
