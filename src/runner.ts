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

/** Index migration files by hash, rejecting duplicate hashes (which would be ambiguous to map). */
function indexByHash(migrations: MigrationFile[]): Map<string, MigrationFile> {
  const byHash = new Map<string, MigrationFile>();
  for (const m of migrations) {
    const existing = byHash.get(m.hash);
    if (existing) {
      throw new Error(
        `Duplicate migration hash ${m.hash} shared by "${existing.tag}" and "${m.tag}". drizzle-rollback maps applied rows to files by hash and cannot disambiguate identical-content migrations.`,
      );
    }
    byHash.set(m.hash, m);
  }
  return byHash;
}

/**
 * Select the applied rows to revert, newest-first: the last `count`, or everything applied
 * after `to`. Operates on applied rows directly (not on file-paired rows) so that older rows
 * without a matching .sql file — e.g. a `drizzle-kit push` baseline — never block reverting
 * recent migrations.
 */
function selectTargetRows(
  applied: AppliedMigration[],
  count: number,
  byHash: Map<string, MigrationFile>,
  to?: string,
): AppliedMigration[] {
  const newestFirst = [...applied].reverse();
  if (to) {
    const idx = newestFirst.findIndex((row) => byHash.get(row.hash)?.tag === to);
    if (idx === -1) throw new Error(`Target migration "${to}" is not applied.`);
    return newestFirst.slice(0, idx);
  }
  return newestFirst.slice(0, count);
}

/** Map a target applied row to its file, failing only for rows we actually intend to revert. */
function resolveTarget(
  row: AppliedMigration,
  byHash: Map<string, MigrationFile>,
  out: string,
): { row: AppliedMigration; migration: MigrationFile } {
  const migration = byHash.get(row.hash);
  if (!migration) {
    throw new Error(
      `Cannot revert applied migration id=${row.id} (hash ${row.hash}): no matching .sql file in ${out}. The file may have been deleted or renamed, \`out\` may be misconfigured, or this row is a non-migration baseline (e.g. from \`drizzle-kit push\`) that drizzle-rollback cannot revert.`,
    );
  }
  return { row, migration };
}

function readDownSql(migration: MigrationFile): string {
  if (!migration.hasDown) {
    throw new Error(
      `Migration "${migration.tag}" has no .down.sql. Run \`drizzle-rollback generate\` and write it.`,
    );
  }
  const sql = readFileSync(migration.downPath, "utf-8");
  if (sql.includes(STUB_MARKER)) {
    throw new Error(
      `Down migration for "${migration.tag}" is an unedited stub. Write the reverse SQL first.`,
    );
  }
  return sql.trim();
}

export async function rollback(opts: RollbackOptions): Promise<RollbackResult> {
  const { config, count = 1, to, dryRun = false, yes = false } = opts;
  const migrations = loadMigrations(config.out);
  const dialect = opts.dialect ?? new PostgresDialect(config);

  try {
    const applied = await dialect.getApplied();
    const byHash = indexByHash(migrations);
    const targets = selectTargetRows(applied, count, byHash, to).map((row) =>
      resolveTarget(row, byHash, config.out),
    );

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
