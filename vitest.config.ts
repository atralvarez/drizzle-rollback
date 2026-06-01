import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
