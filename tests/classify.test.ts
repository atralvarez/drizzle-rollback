import { describe, expect, it } from "vitest";
import { tierOf } from "../src/diff/classify.js";
import type { Operation } from "../src/diff/operations.js";

describe("tierOf", () => {
  it("classifies mechanical undo ops as safe", () => {
    expect(tierOf({ kind: "dropTable", schema: "", table: "x" })).toBe("safe");
    expect(tierOf({ kind: "dropColumn", schema: "", table: "x", column: "c" })).toBe("safe");
    expect(tierOf({ kind: "dropIndex", schema: "", name: "i" })).toBe("safe");
    expect(tierOf({ kind: "dropForeignKey", schema: "", table: "x", name: "fk" })).toBe("safe");
    expect(tierOf({ kind: "dropNotNull", schema: "", table: "x", column: "c" })).toBe("safe");
    expect(tierOf({ kind: "dropEnum", schema: "public", name: "e" })).toBe("safe");
  });

  it("classifies may-fail-against-current-data ops as verify", () => {
    expect(
      tierOf({ kind: "alterColumnType", schema: "", table: "x", column: "c", toType: "text" }),
    ).toBe("verify");
    expect(tierOf({ kind: "setNotNull", schema: "", table: "x", column: "c" })).toBe("verify");
    expect(tierOf({ kind: "addForeignKey", schema: "", table: "x", fk: {} as never })).toBe(
      "verify",
    );
    expect(tierOf({ kind: "addUnique", schema: "", table: "x", unique: {} as never })).toBe(
      "verify",
    );
    expect(tierOf({ kind: "addCompositePk", schema: "", table: "x", pk: {} as never })).toBe(
      "verify",
    );
  });

  it("classifies data-losing / non-expressible ops as lossy", () => {
    expect(tierOf({ kind: "createTable", table: {} as never })).toBe("lossy");
    expect(tierOf({ kind: "addColumn", schema: "", table: "x", column: {} as never })).toBe(
      "lossy",
    );
    expect(
      tierOf({
        kind: "enumValueRemovalUnsupported",
        schema: "public",
        name: "e",
        addedValues: ["X"],
      }),
    ).toBe("lossy");
  });
});
