import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MigrationFile } from "./types.js";

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}
interface Journal {
  entries: JournalEntry[];
}

/** Read all migrations from a Drizzle `out` folder, ordered oldest-first. */
export function loadMigrations(out: string): MigrationFile[] {
  const journalPath = join(out, "meta", "_journal.json");
  if (!existsSync(journalPath)) {
    throw new Error(
      `No Drizzle journal found at ${journalPath}. Run \`drizzle-kit generate\` first.`,
    );
  }
  const journal = JSON.parse(readFileSync(journalPath, "utf-8")) as Journal;

  return [...journal.entries]
    .sort((a, b) => a.idx - b.idx)
    .map((entry) => {
      const upPath = join(out, `${entry.tag}.sql`);
      const downPath = join(out, `${entry.tag}.down.sql`);
      const raw = readFileSync(upPath).toString();
      return {
        idx: entry.idx,
        tag: entry.tag,
        when: entry.when,
        upPath,
        downPath,
        hash: createHash("sha256").update(raw).digest("hex"),
        hasDown: existsSync(downPath),
      } satisfies MigrationFile;
    });
}
