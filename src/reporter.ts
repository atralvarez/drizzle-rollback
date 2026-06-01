import { existsSync, readFileSync } from "node:fs";
import { STUB_MARKER } from "./constants.js";
import type { MigrationFile } from "./types.js";

export interface StatusRow {
  tag: string;
  applied: boolean;
  hasDown: boolean;
}

export interface CheckResult {
  ok: boolean;
  /** Migrations with no .down.sql at all. */
  missing: string[];
  /** Migrations whose .down.sql still contains the unedited stub marker. */
  stubbed: string[];
}

/** Build a per-migration applied/down-presence view. */
export function buildStatus(migrations: MigrationFile[], appliedHashes: Set<string>): StatusRow[] {
  return migrations.map((m) => ({
    tag: m.tag,
    applied: appliedHashes.has(m.hash),
    hasDown: m.hasDown,
  }));
}

/** Flag migrations that lack a usable down (missing file or unedited stub). */
export function runCheck(migrations: MigrationFile[]): CheckResult {
  const missing: string[] = [];
  const stubbed: string[] = [];
  for (const m of migrations) {
    if (!m.hasDown) {
      missing.push(m.tag);
      continue;
    }
    if (existsSync(m.downPath) && readFileSync(m.downPath, "utf-8").includes(STUB_MARKER)) {
      stubbed.push(m.tag);
    }
  }
  return { ok: missing.length === 0 && stubbed.length === 0, missing, stubbed };
}
