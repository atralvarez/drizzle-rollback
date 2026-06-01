import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STUB_MARKER } from "../src/constants.js";
import { generateDownDrafts, generateDownStubs } from "../src/generator.js";

let dir: string;
let out: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dzr-gen-"));
  out = join(dir, "drizzle");
  mkdirSync(join(out, "meta"), { recursive: true });
  writeFileSync(
    join(out, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "postgresql",
      entries: [{ idx: 0, version: "7", when: 1, tag: "0000_init", breakpoints: true }],
    }),
  );
  writeFileSync(join(out, "0000_init.sql"), 'CREATE TABLE "users" ("id" serial);');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("generateDownStubs", () => {
  it("creates a stub .down.sql containing the stub marker", () => {
    const created = generateDownStubs(out);

    expect(created).toEqual(["0000_init"]);
    const stub = readFileSync(join(out, "0000_init.down.sql"), "utf-8");
    expect(stub).toContain(STUB_MARKER);
    expect(stub).toContain("0000_init");
  });

  it("does not overwrite an existing .down.sql", () => {
    writeFileSync(join(out, "0000_init.down.sql"), "DROP TABLE users;");
    const created = generateDownStubs(out);

    expect(created).toEqual([]);
    expect(readFileSync(join(out, "0000_init.down.sql"), "utf-8")).toBe("DROP TABLE users;");
  });
});

describe("generateDownStubs — snapshot-diff drafts", () => {
  // `dir`, `out`, beforeEach/afterEach come from the existing v0.1 block above.
  function writeSnap(num: string, id: string, prevId: string, tables: Record<string, unknown>) {
    writeFileSync(
      join(out, "meta", `${num}_snapshot.json`),
      JSON.stringify({
        version: "7",
        dialect: "postgresql",
        id,
        prevId,
        tables,
        enums: {},
        schemas: {},
        sequences: {},
      }),
    );
  }
  const tbl = (name: string, columns: Record<string, unknown>) => ({
    name,
    schema: "",
    columns,
    indexes: {},
    foreignKeys: {},
    compositePrimaryKeys: {},
    uniqueConstraints: {},
  });
  const c = (name: string, type: string) => ({ name, type, primaryKey: false, notNull: false });

  it("writes a real executable draft for a safe migration (no STUB_MARKER)", () => {
    writeSnap("0000", "id-a", "00000000-0000-0000-0000-000000000000", {
      "public.users": tbl("users", { id: c("id", "serial") }),
    });

    const created = generateDownStubs(out);

    expect(created).toEqual(["0000_init"]);
    const down = readFileSync(join(out, "0000_init.down.sql"), "utf-8");
    expect(down).toContain('DROP TABLE "users";');
    expect(down).not.toContain(STUB_MARKER);
  });

  it("falls back to a plain stub when the snapshot is missing", () => {
    const created = generateDownStubs(out);
    expect(created).toEqual(["0000_init"]);
    const down = readFileSync(join(out, "0000_init.down.sql"), "utf-8");
    expect(down).toContain(STUB_MARKER);
    expect(down).toContain("snapshot for the previous state was not found");
  });

  it("does not overwrite an existing down unless overwrite is set", () => {
    writeFileSync(join(out, "0000_init.down.sql"), "DROP TABLE users;");
    writeSnap("0000", "id-a", "00000000-0000-0000-0000-000000000000", {
      "public.users": tbl("users", { id: c("id", "serial") }),
    });

    expect(generateDownStubs(out)).toEqual([]);
    expect(readFileSync(join(out, "0000_init.down.sql"), "utf-8")).toBe("DROP TABLE users;");

    const created = generateDownStubs(out, { overwrite: true });
    expect(created).toEqual(["0000_init"]);
    expect(readFileSync(join(out, "0000_init.down.sql"), "utf-8")).toContain('DROP TABLE "users";');
  });

  it("dryRun returns drafts without writing files", () => {
    writeSnap("0000", "id-a", "00000000-0000-0000-0000-000000000000", {
      "public.users": tbl("users", { id: c("id", "serial") }),
    });
    const drafts = generateDownDrafts(out);
    expect(drafts).toEqual([
      { tag: "0000_init", sql: 'DROP TABLE "users";', hasUnresolved: false },
    ]);
    expect(() => readFileSync(join(out, "0000_init.down.sql"), "utf-8")).toThrow();
  });

  it("only generates the requested tag when one is given", () => {
    writeFileSync(
      join(out, "meta", "_journal.json"),
      JSON.stringify({
        version: "7",
        dialect: "postgresql",
        entries: [
          { idx: 0, version: "7", when: 1, tag: "0000_init", breakpoints: true },
          { idx: 1, version: "7", when: 2, tag: "0001_more", breakpoints: true },
        ],
      }),
    );
    writeFileSync(join(out, "0001_more.sql"), 'CREATE TABLE "x" ("id" serial);');
    writeSnap("0000", "id-a", "00000000-0000-0000-0000-000000000000", {
      "public.users": tbl("users", { id: c("id", "serial") }),
    });
    writeSnap("0001", "id-b", "id-a", {
      "public.users": tbl("users", { id: c("id", "serial") }),
      "public.x": tbl("x", { id: c("id", "serial") }),
    });

    const created = generateDownStubs(out, { tag: "0001_more" });
    expect(created).toEqual(["0001_more"]);
    expect(() => readFileSync(join(out, "0000_init.down.sql"), "utf-8")).toThrow();
  });
});
