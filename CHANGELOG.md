# drizzle-rollback

## 0.2.0

Initial public release.

### Minor Changes

- **Snapshot-diff auto-generation.** `drizzle-rollback generate` now writes a real first-draft `.down.sql` for every migration missing one, by diffing Drizzle's `meta/NNNN_snapshot.json` pair in reverse. Mechanically-reversible operations (drop a created column/table/index/FK/enum, reverse a rename via `_meta`) are emitted as executable SQL; operations that may fail against current data (re-add a dropped FK/unique, `SET NOT NULL`, revert a column type) are emitted with a `-- verify:` comment that does not block `check`; data-losing or non-expressible operations (restore a dropped table/column, remove an enum value) are written as a commented-out stub plus a `STUB_MARKER`, so `check` fails until a human resolves them. The `STUB_MARKER` is written only when at least one unresolved operation exists — a fully safe draft is ready to commit with no editing.
- **Completeness guard.** Any change in a snapshot section the engine does not auto-reverse yet (`checkConstraints`, sequences, row-level security / `policies`, views, roles) produces an `unsupported` stub plus a `STUB_MARKER`. The generator never silently omits a change it cannot reverse.
- **New `generate` options:** a `[tag]` argument (limit to one migration), `--overwrite` (regenerate, discarding hand edits), and `--dry-run` (print drafts without writing files).
- **`--version` flag** on the CLI.
- **Narrowed public API.** The package root exports only the stable high-level API; reverse-diff engine internals are available under the unstable `drizzle-rollback/internal` subpath (not covered by semver).

### Patch Changes

- Correctly reverse enum value removals (`ALTER TYPE ... ADD VALUE`), column changes on renamed tables, and schema renames.
- Emitter SQL fidelity: escape quotes in identifiers and enum values, schema-qualify `DROP INDEX`, and render index ordering (`DESC`, non-default `NULLS FIRST/LAST`) and `WITH (...)` storage parameters.
- `generate` errors on an unknown migration tag instead of silently doing nothing; the rollback runner fails explicitly when two migrations share a hash.

### Notes

- PostgreSQL only. MySQL/SQLite adapters are planned for a later release.
- The reverse engine works from Drizzle's snapshots, which describe schema only — hand-edited SQL and data migrations (`INSERT`/`UPDATE` backfills) are invisible to it and must be reversed by hand. Always review a generated down before relying on it.
