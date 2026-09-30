// Usage: npm run resume:check [path]
// Validates your real resume after you edit it.
import { loadResume, ResumeError } from "./load.js";

const path = process.argv[2] ?? "../data/private/resume.json";

try {
  const resume = loadResume(path);
  const bullets =
    resume.experience.reduce((n, e) => n + e.bullets.length, 0) +
    resume.projects.reduce((n, p) => n + p.bullets.length, 0);
  console.log(`✔ ${path} is valid (${bullets} bullets)`);
} catch (err) {
  if (err instanceof ResumeError) {
    console.error(`✘ ${err.message}`);
    process.exit(1);
  }
  throw err;
}
