import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { EMPTY_SNAPSHOT_ID, SUPPORTED_SNAPSHOT_VERSION } from "../constants.js";
import type { Snapshot } from "./types.js";

/** A migration's snapshot paired with its predecessor (null = empty/first or unresolved). */
export interface SnapshotPair {
  current: Snapshot;
  prev: Snapshot | null;
}

export interface LoadedSnapshots {
  /** Resolve the (current, prev) pair for the migration with the given journal idx. */
  pairFor(idx: number): SnapshotPair | null;
}

/** Read every `meta/NNNN_snapshot.json`, validate versions, and index by `id`. */
export function loadSnapshots(out: string): LoadedSnapshots {
  const metaDir = join(out, "meta");
  const byId = new Map<string, Snapshot>();
  const byIdx = new Map<number, Snapshot>();

  if (existsSync(metaDir)) {
    for (const file of readdirSync(metaDir)) {
      const match = /^(\d+)_snapshot\.json$/.exec(file);
      if (!match) continue;
      const snap = JSON.parse(readFileSync(join(metaDir, file), "utf-8")) as Snapshot;
      if (snap.version !== SUPPORTED_SNAPSHOT_VERSION) {
        throw new Error(
          `Unsupported snapshot version "${snap.version}" in ${file} (this engine supports "${SUPPORTED_SNAPSHOT_VERSION}").`,
        );
      }
      byId.set(snap.id, snap);
      byIdx.set(Number(match[1]), snap);
    }
  }

  return {
    pairFor(idx: number): SnapshotPair | null {
      const current = byIdx.get(idx);
      if (!current) return null;
      if (current.prevId === EMPTY_SNAPSHOT_ID) return { current, prev: null };
      const prev = byId.get(current.prevId);
      if (!prev) return null; // predecessor pruned/missing -> cannot diff
      return { current, prev };
    },
  };
}
