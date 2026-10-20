import { config } from "dotenv";

// Test env from .env.test. TEST_DB_NAME swaps the database name, so parallel
// workers (e.g. two teammates) each get their own DB and never wipe each other's rows.
export function testEnv(): Record<string, string> {
  const env = { ...config({ path: ".env.test", quiet: true }).parsed };
  const name = process.env.TEST_DB_NAME;
  if (name && env.DATABASE_URL) {
    env.DATABASE_URL = env.DATABASE_URL.replace(/\/careerpilot_test\b/, `/${name}`);
  }
  return env;
}
