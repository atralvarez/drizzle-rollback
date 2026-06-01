import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildStatus, runCheck } from "../src/reporter.js";
import { loadMigrations } from "../src/repository.js";

const OUT = join(__dirname, "fixtures/project/drizzle");

function hashOf(tag: string): string {
  return createHash("sha256")
    .update(readFileSync(join(OUT, `${tag}.sql`)).toString())
    .digest("hex");
}

describe("reporter", () => {
  it("buildStatus marks applied and down presence", () => {
    const migrations = loadMigrations(OUT);
    const appliedHashes = new Set([hashOf("0000_init")]);

    const rows = buildStatus(migrations, appliedHashes);

    expect(rows).toEqual([
      { tag: "0000_init", applied: true, hasDown: true },
      { tag: "0001_add_email", applied: false, hasDown: false },
    ]);
  });

  it("runCheck reports migrations missing a down file", () => {
    const migrations = loadMigrations(OUT);
    const result = runCheck(migrations);

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["0001_add_email"]);
    expect(result.stubbed).toEqual([]);
  });
});
