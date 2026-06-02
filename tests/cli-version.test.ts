import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildProgram } from "../src/cli.js";

describe("CLI --version", () => {
  it("exposes the package.json version", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as {
      version: string;
    };
    expect(buildProgram().version()).toBe(pkg.version);
  });
});
