import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SNAPSHOT_MISSING_MARKER, STUB_MARKER } from "./constants.js";
import { PostgresReverseBuilder } from "./dialects/postgres/reverse.js";
import type { ReverseBuilder } from "./diff/operations.js";
import { loadMigrations } from "./repository.js";
import { loadSnapshots } from "./snapshot/loader.js";

export interface GenerateOptions {
  /** Regenerate even if a .down.sql already exists (discards hand edits). */
  overwrite?: boolean;
  /** Only process this migration tag (default: all missing). */
  tag?: string;
  /** Injected for testing; defaults to PostgresReverseBuilder. */
  builder?: ReverseBuilder;
}

export interface DownDraft {
  tag: string;
  sql: string;
  hasUnresolved: boolean;
}

function plainStub(tag: string): string {
  return `${STUB_MARKER}
${SNAPSHOT_MISSING_MARKER}
-- Down migration for "${tag}".
-- Write the SQL that reverses ${tag}.sql, then delete the marker line(s) above.
-- Separate multiple statements with: --> statement-breakpoint
`;
}

/**
 * Compute the down-file content for every migration missing a .down.sql
 * (or the single requested tag), WITHOUT writing anything. Used by --dry-run.
 */
export function generateDownDrafts(out: string, opts: GenerateOptions = {}): DownDraft[] {
  const builder = opts.builder ?? new PostgresReverseBuilder();
  const snapshots = loadSnapshots(out);
  const drafts: DownDraft[] = [];

  const migrations = loadMigrations(out);
  if (opts.tag && !migrations.some((m) => m.tag === opts.tag)) {
    throw new Error(`No migration found with tag "${opts.tag}".`);
  }
  for (const migration of migrations) {
    if (opts.tag && migration.tag !== opts.tag) continue;
    if (migration.hasDown && !opts.overwrite) continue;

    const pair = snapshots.pairFor(migration.idx);
    if (!pair) {
      drafts.push({ tag: migration.tag, sql: plainStub(migration.tag), hasUnresolved: true });
      continue;
    }
    const result = builder.buildReverse(pair.prev, pair.current);
    drafts.push({ tag: migration.tag, sql: result.sql, hasUnresolved: result.hasUnresolved });
  }
  return drafts;
}

/**
 * Write a .down.sql draft for every migration missing one (or the requested tag).
 * Uses the snapshot-diff engine when snapshots are available, else a plain stub.
 * Returns the tags written.
 */
export function generateDownStubs(out: string, opts: GenerateOptions = {}): string[] {
  const written: string[] = [];
  for (const draft of generateDownDrafts(out, opts)) {
    const downPath = join(out, `${draft.tag}.down.sql`);
    if (existsSync(downPath) && !opts.overwrite) continue;
    writeFileSync(downPath, draft.sql.endsWith("\n") ? draft.sql : `${draft.sql}\n`);
    written.push(draft.tag);
  }
  return written;
}
