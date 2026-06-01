import { Command } from "commander";
import prompts from "prompts";
import { loadConfig } from "./config.js";
import { PostgresDialect } from "./dialects/postgres.js";
import { generateDownStubs } from "./generator.js";
import { buildStatus, runCheck } from "./reporter.js";
import { loadMigrations } from "./repository.js";
import { rollback } from "./runner.js";

interface GlobalOpts {
  config?: string;
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("drizzle-rollback")
    .description("Reliable rollbacks for Drizzle ORM migrations")
    .option("-c, --config <path>", "path to drizzle.config");

  program
    .command("generate")
    .description("Write a stub .down.sql for every migration missing one")
    .action(async () => {
      const { config } = program.opts<GlobalOpts>();
      const resolved = await loadConfig(config);
      const created = generateDownStubs(resolved.out);
      if (created.length === 0) {
        console.log("All migrations already have a .down.sql.");
      } else {
        console.log(`Created ${created.length} stub(s):`);
        for (const tag of created) console.log(`  ${tag}.down.sql`);
        console.log("\nEdit each stub (remove the marker line) before relying on it.");
      }
    });

  program
    .command("down")
    .description("Revert the most recent applied migration(s)")
    .argument("[count]", "number of migrations to revert", "1")
    .option("--to <tag>", "revert everything applied after this migration")
    .option("--dry-run", "print the SQL without executing")
    .option("-y, --yes", "skip the confirmation prompt")
    .action(async (count: string, opts: { to?: string; dryRun?: boolean; yes?: boolean }) => {
      const { config } = program.opts<GlobalOpts>();
      if (!opts.to && !/^\d+$/.test(count)) {
        throw new Error(`Invalid count "${count}". Pass a positive integer or use --to <tag>.`);
      }
      if (!opts.to && Number.parseInt(count, 10) < 1) {
        throw new Error(`Count must be at least 1 (got "${count}").`);
      }
      const resolved = await loadConfig(config);
      const result = await rollback({
        config: resolved,
        count: Number.parseInt(count, 10),
        to: opts.to,
        dryRun: opts.dryRun,
        yes: opts.yes,
        confirm: async (tags) => {
          const { ok } = await prompts({
            type: "confirm",
            name: "ok",
            message: `Revert ${tags.length} migration(s): ${tags.join(", ")}?`,
            initial: false,
          });
          return ok === true;
        },
      });
      if (opts.dryRun) {
        console.log("Dry run — would revert:");
        for (const p of result.planned) console.log(`\n--- ${p.tag} ---\n${p.sql}`);
        return;
      }
      if (result.reverted.length === 0) {
        console.log("Nothing reverted.");
        return;
      }
      console.log(`Reverted: ${result.reverted.join(", ")}`);
    });

  program
    .command("status")
    .description("Show applied migrations and down-file presence")
    .action(async () => {
      const { config } = program.opts<GlobalOpts>();
      const resolved = await loadConfig(config);
      const migrations = loadMigrations(resolved.out);
      const dialect = new PostgresDialect(resolved);
      try {
        const applied = await dialect.getApplied();
        const appliedHashes = new Set(applied.map((r) => r.hash));
        for (const row of buildStatus(migrations, appliedHashes)) {
          const flags = `${row.applied ? "applied" : "pending"}, ${row.hasDown ? "down ✓" : "down ✗"}`;
          console.log(`  ${row.tag.padEnd(40)} ${flags}`);
        }
      } finally {
        await dialect.close();
      }
    });

  program
    .command("check")
    .description("Exit non-zero if any migration lacks a usable down file")
    .action(async () => {
      const { config } = program.opts<GlobalOpts>();
      const resolved = await loadConfig(config);
      const result = runCheck(loadMigrations(resolved.out));
      if (result.ok) {
        console.log("All migrations have a usable .down.sql.");
        return;
      }
      for (const tag of result.missing) console.error(`  missing down: ${tag}`);
      for (const tag of result.stubbed) console.error(`  unedited stub: ${tag}`);
      process.exitCode = 1;
    });

  return program;
}

export async function run(argv: string[]): Promise<void> {
  await buildProgram().parseAsync(argv);
}
