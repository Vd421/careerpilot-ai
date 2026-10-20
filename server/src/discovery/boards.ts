import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

// An entry is a board token, or { token, name } when the display name differs from the slug.
const entrySchema = z.union([z.string(), z.object({ token: z.string(), name: z.string().optional() })]);
const companiesSchema = z.object({
  greenhouse: z.array(entrySchema).default([]),
  lever: z.array(entrySchema).default([]),
  ashby: z.array(entrySchema).default([]),
});
export type CompanyEntry = z.infer<typeof entrySchema>;
export type TargetCompanies = z.infer<typeof companiesSchema>;

export interface Board {
  token: string;
  name: string; // shown as the company: the given name, else the slug in Title Case
}

// "sarvam" -> "Sarvam", "my-co_x" -> "My Co X"
export function titleCaseSlug(slug: string): string {
  return slug.split(/[-_\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

export function toBoards(entries: CompanyEntry[]): Board[] {
  return entries.map((e) => (typeof e === "string" ? { token: e, name: titleCaseSlug(e) } : { token: e.token, name: e.name?.trim() || titleCaseSlug(e.token) }));
}

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
