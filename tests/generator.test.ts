import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STUB_MARKER } from "../src/constants.js";
import { generateDownStubs } from "../src/generator.js";

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
