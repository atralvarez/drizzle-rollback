# drizzle-rollback

Reliable rollbacks for [Drizzle ORM](https://orm.drizzle.team) migrations.

Drizzle generates forward-only migrations and has no built-in `down`/rollback command. `drizzle-rollback` adds one without taking over your migration workflow: it reads the artifacts `drizzle-kit` already produces and reuses Drizzle's own `__drizzle_migrations` tracking table. You keep using `drizzle-kit generate` and `drizzle-kit migrate` exactly as before.

> **v0.1 — PostgreSQL only.** Down SQL is authored by hand (paired `.down.sql` files). Automatic generation of the reverse SQL from Drizzle's snapshots is planned for v0.2; MySQL/SQLite for v0.3+.

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

Chain stub generation onto your generate script so every new migration gets a `.down.sql` to fill in:

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

Writes a stub `.down.sql` for every migration that doesn't have one. Existing down files are never overwritten. Each stub contains a marker comment that you remove once you've written the reverse SQL.

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

## License

MIT © [Aitor Álvarez](https://github.com/atralvarez)
