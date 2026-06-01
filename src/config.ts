import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { createJiti } from "jiti";
import { DEFAULT_OUT, DEFAULT_SCHEMA, DEFAULT_TABLE } from "./constants.js";
import type { PgCredentials, ResolvedConfig } from "./types.js";

interface RawDrizzleConfig {
  dialect?: string;
  out?: string;
  dbCredentials?: PgCredentials;
  migrations?: { table?: string; schema?: string };
}

const CANDIDATES = ["drizzle.config.ts", "drizzle.config.js", "drizzle.config.mjs"];

function findConfig(cwd: string): string {
  for (const name of CANDIDATES) {
    const candidate = resolve(cwd, name);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`No drizzle config found in ${cwd}. Pass --config <path>.`);
}

/** Load and normalize the user's drizzle.config into a ResolvedConfig. */
export async function loadConfig(
  configPath?: string,
  opts: { cwd?: string; dialectOverride?: string } = {},
): Promise<ResolvedConfig> {
  const cwd = opts.cwd ?? process.cwd();
  const path = configPath ? resolve(cwd, configPath) : findConfig(cwd);

  const jiti = createJiti(import.meta.url);
  const raw = (await jiti.import(path, { default: true })) as RawDrizzleConfig;

  const dialect = opts.dialectOverride ?? raw.dialect;
  if (dialect !== "postgresql") {
    throw new Error(`drizzle-rollback v0.1 only supports postgresql (got "${dialect ?? "undefined"}").`);
  }
  if (!raw.dbCredentials) {
    throw new Error("drizzle config is missing `dbCredentials`.");
  }

  const outRaw = raw.out ?? DEFAULT_OUT;
  const configDir = dirname(path);
  const out = isAbsolute(outRaw) ? outRaw : resolve(configDir, outRaw);

  return {
    dialect: "postgresql",
    out,
    migrationsTable: raw.migrations?.table ?? DEFAULT_TABLE,
    migrationsSchema: raw.migrations?.schema ?? DEFAULT_SCHEMA,
    dbCredentials: raw.dbCredentials,
  };
}
