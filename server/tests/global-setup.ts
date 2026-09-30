import { execSync } from "node:child_process";
import { config } from "dotenv";

// Runs once before all tests: bring the test DB schema up to date.
export default function setup() {
  const testEnv = config({ path: ".env.test", quiet: true }).parsed;
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, ...testEnv },
    stdio: "inherit",
  });
}
