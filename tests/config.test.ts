import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const CONFIG = join(__dirname, "fixtures/project/drizzle.config.ts");

describe("loadConfig", () => {
  it("resolves dialect, absolute out path, defaults, and credentials", async () => {
    const config = await loadConfig(CONFIG);

    expect(config.dialect).toBe("postgresql");
    expect(config.out).toBe(join(__dirname, "fixtures/project/drizzle"));
    expect(config.migrationsTable).toBe("__drizzle_migrations");
    expect(config.migrationsSchema).toBe("drizzle");
    expect(config.dbCredentials).toEqual({ url: "postgres://example/db" });
  });

  it("rejects non-postgres dialects in v0.1", async () => {
    await expect(loadConfig(CONFIG, { dialectOverride: "mysql" })).rejects.toThrow(
      /only supports postgresql/i,
    );
  });
});
