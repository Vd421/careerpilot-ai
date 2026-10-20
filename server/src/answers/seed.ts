import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { prisma } from "../db.js";
import { normalizeQuestion } from "./normalize.js";

const ROOT = resolve(import.meta.dirname, "../../..");
export const DEFAULT_ANSWERS_PATH = resolve(ROOT, "data/private/answers.json");

const fileSchema = z.object({
  answers: z.array(
    z.object({
      key: z.string().min(1),
      patterns: z.array(z.string()).default([]),
      answer: z.string().default(""),
      reusable: z.boolean().default(true),
    }),
  ),
});

// Loads my reusable facts (notice period, links, ...) into the answer bank. Empty answers are skipped:
// a blank must never be treated as an approved answer. Upsert by key, so re-running is safe.
export async function seedAnswers(path: string = DEFAULT_ANSWERS_PATH): Promise<{ seeded: number; skipped: number }> {
  if (!existsSync(path)) {
    console.warn(`[answers] ${path} not found, skipping seed (copy data/answers.example.json there)`);
    return { seeded: 0, skipped: 0 };
  }
  let parsed;
  try {
    parsed = fileSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  } catch (err) {
    console.warn(`[answers] ${path} is not valid JSON: ${(err as Error).message}`);
    return { seeded: 0, skipped: 0 };
  }
  if (!parsed.success) {
    console.warn(`[answers] ${path} has the wrong shape: ${parsed.error.message}`);
    return { seeded: 0, skipped: 0 };
  }

  let seeded = 0;
  let skipped = 0;
  for (const entry of parsed.data.answers) {
    const answer = entry.answer.trim();
    if (!answer) {
      skipped++;
      continue;
    }
    const patterns = [...new Set([...entry.patterns.map(normalizeQuestion), normalizeQuestion(entry.key.replaceAll("_", " "))])].filter(Boolean);
    await prisma.answer.upsert({
      where: { key: entry.key },
      update: { patterns, rawAnswer: answer, polishedAnswer: null, approved: true, reusable: true },
      create: {
        key: entry.key,
        questionText: patterns[0] ?? normalizeQuestion(entry.key),
        patterns,
        rawAnswer: answer,
        approved: true,
        reusable: true,
        tags: ["seeded"],
      },
    });
    seeded++;
  }
  return { seeded, skipped };
}
