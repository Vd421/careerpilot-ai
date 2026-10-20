import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const companiesSchema = z.object({
  greenhouse: z.array(z.string()).default([]),
  lever: z.array(z.string()).default([]),
  ashby: z.array(z.string()).default([]),
});
export type TargetCompanies = z.infer<typeof companiesSchema>;

const ROOT = resolve(import.meta.dirname, "../../..");

// data/target-companies.json is mine (gitignored later); fall back to the committed example.
export function loadTargetCompanies(path?: string): TargetCompanies {
  const candidates = path ? [path] : [resolve(ROOT, "data/target-companies.json"), resolve(ROOT, "data/target-companies.example.json")];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const parsed = companiesSchema.safeParse(JSON.parse(readFileSync(p, "utf8")));
    if (parsed.success) return parsed.data;
    console.warn(`[discovery] ${p} is not valid: ${parsed.error.message}`);
  }
  console.warn("[discovery] no target-companies file found; board sources return nothing");
  return { greenhouse: [], lever: [], ashby: [] };
}

// Boards are fetched one after another with a short pause, to be polite.
export const BOARD_PAUSE_MS = 300;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
