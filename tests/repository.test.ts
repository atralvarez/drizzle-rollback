import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadMigrations } from "../src/repository.js";

const OUT = join(__dirname, "fixtures/project/drizzle");

describe("loadMigrations", () => {
  it("lists migrations ordered by idx with hash and down presence", () => {
    const migrations = loadMigrations(OUT);

    expect(migrations.map((m) => m.tag)).toEqual(["0000_init", "0001_add_email"]);
    expect(migrations[0].hasDown).toBe(true);
    expect(migrations[1].hasDown).toBe(false);
    expect(migrations[0].when).toBe(1769968339969);
  });

  it("computes SHA-256 of the full up file, matching Drizzle's hash", () => {
    const migrations = loadMigrations(OUT);
    const raw = readFileSync(join(OUT, "0000_init.sql")).toString();
    const expected = createHash("sha256").update(raw).digest("hex");

    expect(migrations[0].hash).toBe(expected);
  });
});
