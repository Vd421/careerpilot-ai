// Usage: npm run score -- <jd-file> "<company>" "<title>" [url]
// Saves the job, scores it against data/private/resume.json, prints the result.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "../db.js";
import { loadResume } from "../resume/load.js";
import { scoreJob } from "../scoring/scoreJob.js";

const [jdPath, company, title, url] = process.argv.slice(2);
if (!jdPath || !company || !title) {
  console.error('Usage: npm run score -- <jd-file> "<company>" "<title>" [url]');
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set. Add it to server/.env");
  process.exit(1);
}

try {
  const resume = loadResume("../data/private/resume.json");
  const description = readFileSync(jdPath, "utf8");

  const job = await prisma.job.create({ data: { company, title, url, description } });
  const score = await scoreJob(job.id, resume);

  console.log(`\n${title} @ ${company} → ${score.matchScore}%`);
  console.log(`\n${score.summary}`);
  console.log(`\n✔ Matched: ${score.matchedSkills.join(", ") || "-"}`);
  console.log(`✘ Missing: ${score.missingSkills.join(", ") || "-"}`);
  for (const flag of score.redFlags) console.log(`⚠ ${flag.type}: ${flag.detail}`);
} finally {
  await prisma.$disconnect();
}
