import { STUB_MARKER } from "../../constants.js";
import type { ReverseBuilder, ReverseResult } from "../../diff/operations.js";
import type { Snapshot } from "../../snapshot/types.js";
import { diffReverse } from "./differ.js";
import { emitDown } from "./emit.js";

/** Composes the Postgres differ + emitter into the pure ReverseBuilder seam. */
export class PostgresReverseBuilder implements ReverseBuilder {
  buildReverse(prev: Snapshot | null, current: Snapshot): ReverseResult {
    const ops = diffReverse(prev, current);
    const { sql, hasUnresolved } = emitDown(ops);
    const body = hasUnresolved ? `${STUB_MARKER}\n${sql}` : sql;
    return { ops, sql: body, hasUnresolved };
  }
}
