import "dotenv/config";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { seedAnswers } from "../src/answers/index.js";
import { prisma } from "../src/db.js";
import { PRIVATE_DIR, REPO_ROOT } from "../src/tailor/paths.js";

type Db = typeof prisma;

export interface SeedOptions {
  // Absolute paths. Defaults point at data/private/ (gitignored).
  resumeA?: string;
  resumeB?: string;
}

// Idempotent: running it twice changes nothing. Only checks that files EXIST, never reads them.
export async function seedDatabase(db: Db, opts: SeedOptions = {}): Promise<string[]> {
  const notes: string[] = [];

  // Settings row id=1: `update: {}` keeps whatever I changed in the dashboard.
  await db.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  notes.push("Settings ready");

  const variants: [string, string][] = [
    ["A", opts.resumeA ?? resolve(PRIVATE_DIR, "resume.json")],
    ["B", opts.resumeB ?? resolve(PRIVATE_DIR, "resume.b.json")],
  ];
  for (const [name, abs] of variants) {
    if (!existsSync(abs)) {
      notes.push(`Variant ${name}: ${abs} not found, skipped`);
      continue;
    }
    // Stored relative to repo root when possible (portable across machines).
    const filePath = abs.startsWith(REPO_ROOT) ? abs.slice(REPO_ROOT.length + 1).replaceAll("\\", "/") : abs;
    await db.resumeVariant.upsert({ where: { name }, update: { filePath }, create: { name, filePath } });
    notes.push(`Variant ${name} -> ${filePath}`);
  }
  return notes;
}

// Run only when executed directly (npm run db:seed), not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedDatabase(prisma)
    .then((notes) => notes.forEach((n) => console.log(n)))
    // Answer bank from data/private/answers.json (missing file → warning, not a crash)
    .then(() => seedAnswers())
    .then(({ seeded, skipped }) => console.log(`Answer bank: ${seeded} seeded, ${skipped} skipped (empty)`))
    .finally(() => prisma.$disconnect());
}
