import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSnapshots } from "../src/snapshot/loader.js";

let dir: string;
let meta: string;

function writeSnap(num: string, id: string, prevId: string, tables = {}) {
  writeFileSync(
    join(meta, `${num}_snapshot.json`),
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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dzr-snap-"));
  meta = join(dir, "drizzle", "meta");
  mkdirSync(meta, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("loadSnapshots", () => {
  it("indexes snapshots by id and resolves a migration's (current, prev) pair", () => {
    writeSnap("0000", "id-a", "00000000-0000-0000-0000-000000000000");
    writeSnap("0001", "id-b", "id-a");
    const out = join(dir, "drizzle");

    const snaps = loadSnapshots(out);

    expect(snaps.pairFor(1)).toEqual({
      current: expect.objectContaining({ id: "id-b" }),
      prev: expect.objectContaining({ id: "id-a" }),
    });
  });

  it("returns prev=null for the first migration (empty sentinel prevId)", () => {
    writeSnap("0000", "id-a", "00000000-0000-0000-0000-000000000000");
    const snaps = loadSnapshots(join(dir, "drizzle"));

    const pair = snaps.pairFor(0);
    expect(pair?.current.id).toBe("id-a");
    expect(pair?.prev).toBeNull();
  });

  it("returns null when the migration's own snapshot file is missing", () => {
    writeSnap("0000", "id-a", "00000000-0000-0000-0000-000000000000");
    const snaps = loadSnapshots(join(dir, "drizzle"));

    expect(snaps.pairFor(5)).toBeNull();
  });

  it("returns null when the predecessor snapshot is missing (gap)", () => {
    writeSnap("0001", "id-b", "id-a");
    const snaps = loadSnapshots(join(dir, "drizzle"));

    expect(snaps.pairFor(1)).toBeNull();
  });

  it("rejects an unsupported snapshot version", () => {
    writeFileSync(
      join(meta, "0000_snapshot.json"),
      JSON.stringify({
        version: "6",
        dialect: "postgresql",
        id: "x",
        prevId: "00000000-0000-0000-0000-000000000000",
        tables: {},
        enums: {},
        schemas: {},
        sequences: {},
      }),
    );
    expect(() => loadSnapshots(join(dir, "drizzle"))).toThrow(/unsupported snapshot version/i);
  });
});
