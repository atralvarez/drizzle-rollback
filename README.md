# drizzle-rollback

Reliable rollbacks for [Drizzle ORM](https://orm.drizzle.team) migrations.

Drizzle generates forward-only migrations and has no built-in `down`/rollback command. `drizzle-rollback` adds one without taking over your migration workflow: it reads the artifacts `drizzle-kit` already produces and reuses Drizzle's own `__drizzle_migrations` tracking table. You keep using `drizzle-kit generate` and `drizzle-kit migrate` exactly as before.

> **v0.2 — PostgreSQL only.** `generate` now auto-drafts the reverse SQL by diffing Drizzle's `meta/NNNN_snapshot.json` files. MySQL/SQLite remain planned for v0.3+.

## How it works

For every migration `drizzle-kit` generates (`0001_name.sql`), you commit a sibling `0001_name.down.sql` containing the SQL that reverses it. These down files are reviewed in the same PR as the forward migration and run verbatim at rollback time — no runtime-synthesized schema changes.

Rollback maps each applied row in `__drizzle_migrations` back to its migration file by SHA-256 hash, then runs the matching `.down.sql` and deletes the tracking row **in a single transaction** (one transaction per migration), so a failure always leaves you at a consistent point in history.

## Install

```bash
pnpm add -D drizzle-rollback
# or: npm i -D drizzle-rollback / yarn add -D drizzle-rollback
```

`drizzle-orm` and `drizzle-kit` are peer dependencies — you bring your own. No new configuration: `drizzle-rollback` reads your existing `drizzle.config.ts` (`dialect`, `dbCredentials`, `out`, `migrations.table`/`migrations.schema`).

## Recommended setup

Chain generation onto your generate script so every new migration gets a `.down.sql` draft automatically:

```jsonc
// package.json
{
  "scripts": {
    "db:generate": "drizzle-kit generate && drizzle-rollback generate",
    "db:rollback": "drizzle-rollback down"
  }
}
```

Add the CI guard so a migration can never merge without a usable down:

```bash
drizzle-rollback check
```

## Commands

The binary is `drizzle-rollback` (short alias: `dzr`). A custom config path can be passed with `-c, --config <path>`.

### `drizzle-rollback generate`

Writes a `.down.sql` draft for every migration that doesn't have one, by diffing the corresponding Drizzle snapshot pair (`meta/NNNN_snapshot.json` vs its predecessor). Existing down files are never overwritten unless `--overwrite` is passed.

```bash
drizzle-rollback generate                  # draft all migrations missing a .down.sql
drizzle-rollback generate 0003_add_orders  # draft only this migration
drizzle-rollback generate --overwrite      # regenerate even if a .down.sql exists (discards edits)
drizzle-rollback generate --dry-run        # print drafts without writing any files
```

**Draft quality — three possible outcomes per operation:**

| Outcome | Written | `check` result |
|---|---|---|
| Mechanically-reversible op | Executable SQL | Passes immediately |
| May-fail-against-current-data op | Executable SQL preceded by a `-- verify:` comment | Passes (human review encouraged) |
| Data-losing or non-expressible op | Commented-out stub block + `STUB_MARKER` line | Fails until a human edits it |

Mechanically-reversible ops include: dropping a column or table that was added, dropping an index/FK/unique/enum that was created, and reversing a rename (via Drizzle's `_meta`).

`-- verify:` ops are executable but may fail against real data — for example, re-adding a foreign key that was dropped, re-adding a `UNIQUE` constraint, setting `NOT NULL`, or reverting a column type change.

Data-losing or non-expressible ops — such as restoring a dropped table or column (data cannot be recovered), or removing an enum value (Postgres cannot express it) — are written as commented-out SQL with the `STUB_MARKER` line above them. The `STUB_MARKER` is written **only when at least one such unresolved op exists**. A fully-safe draft has no marker and passes `check` without any editing.

**Not-yet-supported sections:** some Postgres snapshot sections aren't auto-reversed yet — `checkConstraints`, sequences, row-level security (`isRLSEnabled`/`policies`), views, and roles. If a migration changes one of these, the draft includes an `unsupported` stub block plus the `STUB_MARKER`, so `check` fails until you write that part of the down by hand. The tool never silently omits a change it can't reverse.

**Snapshot-missing fallback:** auto-generation requires both the migration's snapshot and its predecessor's snapshot. If either is absent (e.g. a pruned `meta/` folder), `generate` falls back to a plain hand-authoring stub for that migration. v0.2 is most useful for migrations generated from the point of adoption forward.

### `drizzle-rollback down [count]`

Reverts applied migrations, newest first. Defaults to `1`.

```bash
drizzle-rollback down            # revert the most recent migration
drizzle-rollback down 3          # revert the last 3
drizzle-rollback down --to 0004_orders   # revert everything applied after 0004_orders
drizzle-rollback down --dry-run  # print the SQL that would run, touch nothing
drizzle-rollback down --yes      # skip the confirmation prompt (CI)
```

Before touching the database, `down` validates that every targeted migration has a `.down.sql` and that it is not still an unedited stub — so it fails fast rather than half-way through.

### `drizzle-rollback status`

Lists each migration with whether it's applied and whether it has a `.down.sql`.

### `drizzle-rollback check`

Exits non-zero if any migration is missing a `.down.sql` or still contains the unedited stub marker. Intended for CI.

## Programmatic API

Everything the CLI does is exported for use in scripts:

```ts
import { loadConfig, rollback, runCheck, loadMigrations } from "drizzle-rollback";

const config = await loadConfig();
const result = await rollback({ config, count: 1, yes: true });
console.log(result.reverted); // ["0005_add_widgets"]
```

The reverse-diff engine internals (`diffReverse`, `emitDown`, `loadSnapshots`, the `Operation` IR, etc.) are available under the `drizzle-rollback/internal` subpath. They are **not** covered by semver and may change in any release — prefer the package root for anything stable.

## License

MIT © [Aitor Álvarez](https://github.com/atralvarez)
