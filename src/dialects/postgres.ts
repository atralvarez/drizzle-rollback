import { Client } from "pg";
import { BREAKPOINT } from "../constants.js";
import type { AppliedMigration, Dialect, PgCredentials, ResolvedConfig } from "../types.js";

function toClientConfig(creds: PgCredentials): { connectionString: string } | PgCredentials {
  if ("url" in creds) return { connectionString: creds.url };
  return creds;
}

/** Split a .sql file into individual statements on Drizzle's breakpoint marker. */
function splitStatements(sql: string): string[] {
  return sql
    .split(BREAKPOINT)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export class PostgresDialect implements Dialect {
  private readonly client: Client;
  private readonly table: string;
  private connected = false;

  constructor(private readonly config: ResolvedConfig) {
    this.client = new Client(toClientConfig(config.dbCredentials) as never);
    this.table = `"${config.migrationsSchema}"."${config.migrationsTable}"`;
  }

  private async connect(): Promise<void> {
    if (!this.connected) {
      await this.client.connect();
      this.connected = true;
    }
  }

  async getApplied(): Promise<AppliedMigration[]> {
    await this.connect();
    const res = await this.client.query<{ id: number; hash: string; created_at: string }>(
      `SELECT id, hash, created_at FROM ${this.table} ORDER BY created_at ASC, id ASC`,
    );
    return res.rows.map((r) => ({ id: r.id, hash: r.hash, createdAt: Number(r.created_at) }));
  }

  async revertOne(downSql: string, row: AppliedMigration): Promise<void> {
    await this.connect();
    try {
      await this.client.query("BEGIN");
      for (const statement of splitStatements(downSql)) {
        await this.client.query(statement);
      }
      await this.client.query(`DELETE FROM ${this.table} WHERE id = $1`, [row.id]);
      await this.client.query("COMMIT");
    } catch (err) {
      await this.client.query("ROLLBACK");
      throw err;
    }
  }

  async close(): Promise<void> {
    if (this.connected) {
      await this.client.end();
      this.connected = false;
    }
  }
}
