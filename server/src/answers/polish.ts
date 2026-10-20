import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { getClaude, MODELS, type ModelResult } from "../ai/client.js";

export type PolishModel = (system: string, user: string) => Promise<ModelResult>;

export const polishSchema = z.object({ polished: z.string().min(1) });

export const POLISH_SYSTEM_PROMPT = `You polish a job applicant's rough answer to an application-form question.
Fix grammar, spelling and tone only. Keep it concise and in the first person.
Do NOT add any fact, number, date, name, company, tool, URL or claim that is not in the rough answer.
Do NOT remove facts either. If the rough answer is already fine, return it unchanged.`;

export const claudePolish: PolishModel = async (system, user) => {
  // No `thinking` option: Sonnet 5.5 can't have it disabled, so we leave it unset.
  const response = await getClaude().messages.parse({
    model: MODELS.better,
    max_tokens: 800,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { format: zodOutputFormat(polishSchema) },
  });
  return {
    output: response.parsed_output,
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    stopReason: response.stop_reason,
  };
};

export const buildPolishPrompt = (question: string, raw: string) => `Question: ${question}\n\nRough answer:\n${raw}`;

// ---------------------------------------------------------------------------
// The code check behind "no new facts". The model is told not to add anything; this verifies it.
// ---------------------------------------------------------------------------

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"')]+/gi;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const WORD_OK = new Set(["i", "i'm", "i'd", "i'll", "i've", "im", "id"]);

const cleanNumber = (n: string) => n.replace(/,/g, "").replace(/\.$/, "");
const trimUrl = (u: string) => u.replace(/[.,;:!?]+$/, "").toLowerCase();

export function findNewFacts(raw: string, polished: string): string[] {
  const rawLower = raw.toLowerCase();
  const added: string[] = [];

  const rawNumbers = new Set((raw.match(NUMBER) ?? []).map(cleanNumber));
  for (const n of polished.match(NUMBER) ?? []) {
    if (!rawNumbers.has(cleanNumber(n))) added.push(`number ${n}`);
  }

  const rawUrls = new Set((raw.match(URL_RE) ?? []).map(trimUrl));
  for (const u of polished.match(URL_RE) ?? []) {
    if (!rawUrls.has(trimUrl(u))) added.push(`URL ${u}`);
  }

  const rawEmails = new Set((raw.match(EMAIL) ?? []).map((e) => e.toLowerCase()));
  for (const e of polished.match(EMAIL) ?? []) {
    if (!rawEmails.has(e.toLowerCase())) added.push(`email ${e}`);
  }

  // Capitalized words in the middle of a sentence are names (companies, tools, places).
  // Sentence-initial words are skipped because polishing legitimately capitalizes them.
  const withoutLinks = polished.replace(URL_RE, " ").replace(EMAIL, " ");
  const wordRe = /[A-Za-z][A-Za-z0-9+#.&'-]*/g;
  let m: RegExpExecArray | null;
  while ((m = wordRe.exec(withoutLinks))) {
    const word = m[0].replace(/[.'&-]+$/, "");
    if (!word || !/^[A-Z]/.test(word) || WORD_OK.has(word.toLowerCase())) continue;
    const before = withoutLinks.slice(0, m.index).trimEnd();
    const sentenceStart = before === "" || /[.!?:\n]$/.test(before);
    if (sentenceStart) continue;
    if (!new RegExp(`(^|[^a-z0-9])${word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(rawLower)) {
      added.push(`name ${word}`);
    }
  }
  return [...new Set(added)];
}

export interface PolishOutcome {
  polished: string; // the text offered as "polished"; equals raw when the polish was discarded
  usable: boolean; // false -> the polish was discarded, only the original is offered
  newFacts: string[];
}

export async function polishAnswer(
  question: string,
  raw: string,
  model: PolishModel,
  onCall?: (r: ModelResult) => Promise<void>,
): Promise<PolishOutcome> {
  const result = await model(POLISH_SYSTEM_PROMPT, buildPolishPrompt(question, raw));
  await onCall?.(result); // log tokens before validating
  const parsed = polishSchema.safeParse(result.output);
  if (!parsed.success) return { polished: raw, usable: false, newFacts: ["unusable model output"] };
  const polished = parsed.data.polished.trim();
  const newFacts = findNewFacts(raw, polished);
  if (newFacts.length > 0) return { polished: raw, usable: false, newFacts };
  return { polished, usable: polished !== raw.trim(), newFacts: [] };
}
