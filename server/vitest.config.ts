import { defineConfig } from "vitest/config";
import { testEnv } from "./tests/helpers/testEnv.js";

export default defineConfig({
  test: {
    // Tests always use the test database, never dev data
    env: testEnv(),
    globalSetup: "./tests/global-setup.ts",
    // Test files share one DB, so run them one at a time
    fileParallelism: false,
  },
});
