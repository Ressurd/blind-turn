import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    hookTimeout: 10_000,
    testTimeout: 10_000,
  },
});
