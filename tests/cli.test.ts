import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/cli.js";

const CONFIG = join(__dirname, "fixtures/project/drizzle.config.ts");
let logs: string[];
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logs = [];
  logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.join(" "));
  });
});
afterEach(() => {
  logSpy.mockRestore();
});

describe("CLI generate", () => {
  it("--dry-run prints a draft for a migration missing its down without writing files", async () => {
    await run(["node", "dzr", "--config", CONFIG, "generate", "--dry-run"]);
    const out = logs.join("\n");
    // The fixture's 0001_add_email has no .down.sql and no snapshot -> a plain stub draft is printed.
    expect(out).toContain("0001_add_email.down.sql");
  });

  it("errors when given an unknown tag", async () => {
    await expect(
      run(["node", "dzr", "--config", CONFIG, "generate", "9999_nope", "--dry-run"]),
    ).rejects.toThrow(/no migration found with tag/i);
  });
});
