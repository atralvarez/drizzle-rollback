import { readFileSync } from "node:fs";
import { STUB_MARKER } from "./constants.js";
import { PostgresDialect } from "./dialects/postgres.js";
import { loadMigrations } from "./repository.js";
import type { AppliedMigration, Dialect, MigrationFile, ResolvedConfig } from "./types.js";

export interface RollbackOptions {
  config: ResolvedConfig;
  /** Number of migrations to revert (ignored when `to` is set). Default 1. */
  count?: number;
  /** Revert everything applied after this tag (exclusive). */
  to?: string;
  dryRun?: boolean;
  /** Skip the confirmation prompt. */
  yes?: boolean;
  /** Confirmation callback; defaults to auto-yes. Return false to abort. */
  confirm?: (tags: string[]) => Promise<boolean>;
  /** Injected for testing; defaults to a PostgresDialect. */
  dialect?: Dialect;
}

export interface PlannedRevert {
  tag: string;
  sql: string;
}
export interface RollbackResult {
  reverted: string[];
  planned: PlannedRevert[];
}

/** Pair each applied row with its migration file by hash, oldest-first. */
function pairApplied(
  applied: AppliedMigration[],
  migrations: MigrationFile[],
): Array<{ row: AppliedMigration; migration: MigrationFile }> {
  const byHash = new Map(migrations.map((m) => [m.hash, m]));
  return applied.map((row) => {
    const migration = byHash.get(row.hash);
    if (!migration) {
      throw new Error(`Applied migration with hash ${row.hash} has no matching .sql file in the migrations folder.`);
    }
    return { row, migration };
  });
}

function selectTargets(
  paired: Array<{ row: AppliedMigration; migration: MigrationFile }>,
  count: number,
  to?: string,
): Array<{ row: AppliedMigration; migration: MigrationFile }> {
  const newestFirst = [...paired].reverse();
  if (to) {
    const idx = newestFirst.findIndex((p) => p.migration.tag === to);
    if (idx === -1) throw new Error(`Target migration "${to}" is not applied.`);
    return newestFirst.slice(0, idx);
  }
  return newestFirst.slice(0, count);
}

function readDownSql(migration: MigrationFile): string {
  if (!migration.hasDown) {
    throw new Error(`Migration "${migration.tag}" has no .down.sql. Run \`drizzle-rollback generate\` and write it.`);
  }
  const sql = readFileSync(migration.downPath, "utf-8");
  if (sql.includes(STUB_MARKER)) {
    throw new Error(`Down migration for "${migration.tag}" is an unedited stub. Write the reverse SQL first.`);
  }
  return sql.trim();
}

export async function rollback(opts: RollbackOptions): Promise<RollbackResult> {
  const { config, count = 1, to, dryRun = false, yes = false } = opts;
  const migrations = loadMigrations(config.out);
  const dialect = opts.dialect ?? new PostgresDialect(config);

  try {
    const applied = await dialect.getApplied();
    const targets = selectTargets(pairApplied(applied, migrations), count, to);

    const planned: PlannedRevert[] = targets.map((t) => ({
      tag: t.migration.tag,
      sql: readDownSql(t.migration),
    }));

    if (dryRun) {
      return { reverted: [], planned };
    }

    const confirm = opts.confirm ?? (async () => true);
    if (!yes && !(await confirm(planned.map((p) => p.tag)))) {
      return { reverted: [], planned };
    }

    const reverted: string[] = [];
    for (let i = 0; i < targets.length; i++) {
      await dialect.revertOne(planned[i].sql, targets[i].row);
      reverted.push(targets[i].migration.tag);
    }
    return { reverted, planned };
  } finally {
    await dialect.close();
  }
}
