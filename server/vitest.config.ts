import { defineConfig } from "vitest/config";
import { config } from "dotenv";

export default defineConfig({
  test: {
    // Tests always use the test database, never dev data
    env: config({ path: ".env.test", quiet: true }).parsed,
    globalSetup: "./tests/global-setup.ts",
    // Test files share one DB, so run them one at a time
    fileParallelism: false,
  },
});
