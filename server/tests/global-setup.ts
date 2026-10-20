import { execSync } from "node:child_process";
import { testEnv } from "./helpers/testEnv.js";

// Runs once before all tests: bring the test DB schema up to date.
export default function setup() {
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, ...testEnv() },
    stdio: "inherit",
  });
}
