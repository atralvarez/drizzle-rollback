# AGENTS.md

Guidance for AI coding agents (and humans) working in this repo.

## What this is

`drizzle-rollback` adds rollback support to [Drizzle ORM](https://orm.drizzle.team) migrations. It is a **complement, not a replacement**: it reads the artifacts `drizzle-kit` already produces (`out/NNNN_name.sql`, `out/meta/_journal.json`, `out/meta/NNNN_snapshot.json`) and reuses Drizzle's native `__drizzle_migrations` tracking table. It never wraps or intercepts `drizzle-kit` commands — you keep running `drizzle-kit generate` / `migrate` as-is.

From v0.2 it **auto-generates** draft `.down.sql` files by diffing Drizzle's snapshots in reverse; you review and commit them like any other migration artifact, and they run verbatim at rollback time.

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
- **PostgreSQL only.** DB-specific work lives behind two seams: the DB `Dialect` interface (`src/types.ts`, impl `src/dialects/postgres.ts`) for *execution*, and the pure `ReverseBuilder` (`src/diff/operations.ts`, impl `src/dialects/postgres/reverse.ts`) for *reverse-SQL generation* (no DB). Adding MySQL/SQLite = new adapters behind these seams, not changes elsewhere.
- **Down files are committed artifacts.** Rollback runs the committed `.down.sql` verbatim — never synthesize schema-mutating SQL at runtime. The unedited-stub marker is `STUB_MARKER` in `src/constants.ts`.
- **Tests use real Postgres** via `@testcontainers/postgresql` (no DB mocks). Docker must be running.
- **Commits: single subject line only.** No body, no `Co-Authored-By` trailer. e.g. `git commit -m "feat: ..."`.

## Architecture

Two layers: the **runtime** (reads artifacts, talks to Postgres, executes downs) and the **reverse-diff engine** (pure, no DB — turns snapshot pairs into draft `.down.sql`).

| File | Responsibility |
|---|---|
| `src/config.ts` | Load + normalize `drizzle.config.ts` (via jiti, based at the config path) → `ResolvedConfig` |
| `src/repository.ts` | Read journal + `.sql` files, SHA-256 hash, detect `.down.sql` |
| `src/reporter.ts` | `status` / `check` views |
| `src/runner.ts` | Orchestrate rollback: pair applied rows to files by hash, select targets, revert per-migration in a transaction |
| `src/dialects/postgres.ts` | The DB `Dialect`: tracking queries + transactional revert. The only file that *executes* SQL. |
| `src/snapshot/types.ts` | Types for Drizzle's `meta/NNNN_snapshot.json` shape |
| `src/snapshot/loader.ts` | Read all snapshots; pair each migration with its predecessor by `prevId` |
| `src/diff/operations.ts` | Shared `Operation[]` IR (discriminated union) + the `ReverseBuilder` seam |
| `src/diff/classify.ts` | `tierOf(op)` → `safe` / `verify` / `lossy` |
| `src/dialects/postgres/differ.ts` | Diff a snapshot pair in reverse (`current → prev`) → `Operation[]` |
| `src/dialects/postgres/emit.ts` | Render `Operation[]` → Postgres SQL with tiers + dependency ordering |
| `src/dialects/postgres/reverse.ts` | `PostgresReverseBuilder` — composes differ + emit; prepends `STUB_MARKER` when unresolved |
| `src/generator.ts` | `generate`: build a draft per migration via the `ReverseBuilder`; fall back to a plain stub when snapshots are missing |
| `src/cli.ts` / `bin/` | commander CLI (`generate [tag] --overwrite --dry-run`, `down`, `status`, `check`, `--version`) |
| `src/index.ts` / `src/internal.ts` | Stable public API root; engine internals under the unstable `drizzle-rollback/internal` subpath |

Applied rows are mapped to files **by SHA-256 hash** (the native table has no filename column); the runner throws on duplicate hashes. Each revert runs the down SQL and deletes the tracking row in **one transaction per migration**.

**Down generation:** `generate` diffs `snapshot[N] → snapshot[N-1]` (reverse direction). Mechanically-reversible ops → executable SQL; may-fail-against-current-data ops → executable + `-- verify:`; data-losing / non-expressible ops → commented stub + `STUB_MARKER` (so `check` fails). A **completeness guard** flags any change in a not-yet-handled section (`checkConstraints`, sequences, RLS / `policies`, views, roles) as `unsupported` — the generator never silently omits a change. The snapshot diff is the *first-draft writer*, never a runtime substitute: the committed `.down.sql` is what runs.

## Roadmap / scope

- **v0.2 (current):** Postgres. Snapshot-diff auto-generation of `.down.sql` (executable / `-- verify:` / lossy-stub tiers) with a completeness guard; hand-editing still supported; transactional runner; `status` / `check`; CLI + narrowed programmatic API.
- **0.2.x:** real reversal of the sections currently flagged `unsupported` — `checkConstraints`, sequences, RLS / `policies`, views, roles.
- **v0.3+:** MySQL / SQLite adapters (new differ + emitter behind the existing seams).

Release: npm via changesets + **Trusted Publishing (OIDC)** (no stored token). CI on GitHub Actions (Node 24; Docker for Testcontainers). Design docs live in `docs/specs/` and `docs/plans/` (local-only).
