import { writeFileSync } from "node:fs";
import { STUB_MARKER } from "./constants.js";
import { loadMigrations } from "./repository.js";

function stubContent(tag: string): string {
  return `${STUB_MARKER}
-- Down migration for "${tag}".
-- Write the SQL that reverses ${tag}.sql, then delete the marker line above.
-- Separate multiple statements with: --> statement-breakpoint
`;
}

/**
 * Write a stub .down.sql for every migration that lacks one.
 * Returns the tags for which a stub was created.
 */
export function generateDownStubs(out: string): string[] {
  const created: string[] = [];
  for (const migration of loadMigrations(out)) {
    if (migration.hasDown) continue;
    writeFileSync(migration.downPath, stubContent(migration.tag));
    created.push(migration.tag);
  }
  return created;
}
