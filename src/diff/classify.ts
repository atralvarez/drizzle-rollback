import type { Operation } from "./operations.js";

export type Tier = "safe" | "verify" | "lossy";

const LOSSY = new Set<Operation["kind"]>([
  "createTable",
  "addColumn",
  "enumValueRemovalUnsupported",
]);
const VERIFY = new Set<Operation["kind"]>([
  "alterColumnType",
  "setNotNull",
  "addForeignKey",
  "addUnique",
  "addCompositePk",
]);

/** Map an operation to its risk tier (drives executable-vs-stub emission and `check`). */
export function tierOf(op: Operation): Tier {
  if (LOSSY.has(op.kind)) return "lossy";
  if (VERIFY.has(op.kind)) return "verify";
  return "safe";
}
