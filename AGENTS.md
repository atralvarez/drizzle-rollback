# AGENTS.md

Guidance for AI coding agents (and humans) working in this repo.

## What this is

`drizzle-rollback` adds rollback support to [Drizzle ORM](https://orm.drizzle.team) migrations. It is a **complement, not a replacement**: it reads the artifacts `drizzle-kit` already produces (`out/NNNN_name.sql`, `out/meta/_journal.json`) and reuses Drizzle's native `__drizzle_migrations` tracking table. It never wraps or intercepts `drizzle-kit` commands — you keep running `drizzle-kit generate` / `migrate` as-is.

## Commands

```bash
pnpm install        # install (pnpm only)
pnpm test           # full Vitest suite — REQUIRES Docker (Testcontainers spins up Postgres)
pnpm build          # tsup → dist/ (ESM + CJS + d.ts)
pnpm lint           # biome check
pnpm typecheck      # tsc --noEmit
```

Run a single test file: `pnpm vitest run tests/<file>.test.ts`.

## Conventions (non-obvious — follow these)

- **ESM with explicit `.js` import extensions.** The package is `"type": "module"`; source imports must use `.js` even for `.ts` files (`import { x } from "./types.js"`). Tests import from `../src/foo.js`.
- **TypeScript strict.** Keep `pnpm typecheck` at exit 0.
- **PostgreSQL only (v0.1).** All DB-specific SQL lives behind the `Dialect` interface (`src/types.ts`) and is implemented in `src/dialects/postgres.ts`. Adding MySQL/SQLite = a new adapter, not changes elsewhere.
- **Down files are committed artifacts.** Rollback runs the committed `.down.sql` verbatim — never synthesize schema-mutating SQL at runtime. The unedited-stub marker is `STUB_MARKER` in `src/constants.ts`.
- **Tests use real Postgres** via `@testcontainers/postgresql` (no DB mocks). Docker must be running.
- **Commits: single subject line only.** No body, no `Co-Authored-By` trailer. e.g. `git commit -m "feat: ..."`.

## Architecture

| File | Responsibility |
|---|---|
| `src/config.ts` | Load + normalize `drizzle.config.ts` (via jiti) → `ResolvedConfig` |
| `src/repository.ts` | Read journal + `.sql` files, SHA-256 hash, detect `.down.sql` |
| `src/generator.ts` | Write stub `.down.sql` for migrations missing one |
| `src/reporter.ts` | `status` / `check` views |
| `src/dialects/postgres.ts` | The only file that speaks SQL: tracking queries + transactional revert |
| `src/runner.ts` | Orchestrate: pair applied rows to files by hash, select targets, revert per-migration in a transaction |
| `src/cli.ts` / `bin/` | commander CLI (`generate`, `down`, `status`, `check`) |
| `src/index.ts` | Programmatic API exports |

Applied rows are mapped to files **by SHA-256 hash** (the native table has no filename column). Each revert runs the down SQL and deletes the tracking row in **one transaction per migration**.

## Roadmap / scope

- **v0.1 (current):** Postgres, hand-written `.down.sql`, transactional runner, `status`/`check`.
- **v0.2:** auto-generate the reverse SQL from Drizzle's `meta/*_snapshot.json` diffs (the key differentiator).
- **v0.3+:** MySQL / SQLite adapters.

Design docs live in `docs/specs/` and `docs/plans/`.
