import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { getClaude, MODELS, type ModelResult } from "../ai/client.js";
import type { FieldType } from "../contracts.js";
import { prisma } from "../db.js";
import type { Answer } from "../generated/prisma/client.js";
import { containsPhrase, mapToOption, normalizeQuestion } from "./normalize.js";

// Anything that takes a prompt and returns a ModelResult (same idea as ScoringModel). Tests pass a fake.
export type ClassifierModel = (system: string, user: string) => Promise<ModelResult>;

const classifierSchema = z.object({ key: z.string() });

export const claudeClassifier: ClassifierModel = async (system, user) => {
  const response = await getClaude().messages.parse({
    model: MODELS.cheap,
    max_tokens: 100, // it only returns one short key
    thinking: { type: "disabled" }, // or thinking would eat the 100-token budget
    system,
    messages: [{ role: "user", content: user }],
    output_config: { format: zodOutputFormat(classifierSchema) },
  });
  return {
    output: response.parsed_output,
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    stopReason: response.stop_reason,
  };
};

const CLASSIFIER_SYSTEM = `You match a job-application form question to a list of saved questions.
Reply with the key of the saved question that asks for the SAME information, or "none".
Never invent a key. If unsure, reply "none". You only see questions, never the answers.`;

export interface MatchedAnswer {
  answerId: number;
  value: string; // exactly what goes into the form
  via: "exact" | "pattern" | "classifier";
}

// What gets typed into a form: the approved final text (polished/edited), else what I typed.
export const answerValue = (a: Pick<Answer, "polishedAnswer" | "rawAnswer">) => (a.polishedAnswer ?? a.rawAnswer).trim();

// A value is usable for this field, or null. select/radio must map onto one of the options.
function usable(value: string, fieldType: FieldType, options: string[]): string | null {
  if (!value) return null;
  if ((fieldType === "select" || fieldType === "radio") && options.length > 0) return mapToOption(value, options);
  return value;
}

// A pattern is only trusted when it covers most of the question. Otherwise "How did you hear about us? LinkedIn?"
// would get my LinkedIn URL. Fixed-choice fields are already protected by option mapping, so only free text is strict.
export function patternApplies(q: string, pattern: string, fieldType: FieldType): boolean {
  if (!containsPhrase(q, pattern)) return false;
  if (fieldType === "select" || fieldType === "radio") return true;
  const words = (t: string) => (t ? t.split(" ").length : 0);
  return q.startsWith(pattern) || words(q) <= words(pattern) + 3;
}

// 1) exact normalized match / phrase containment among approved reusable answers
// 2) else a cheap model that may only PICK a saved key (it never sees or writes answers)
export async function matchAnswer(
  questionText: string,
  fieldType: FieldType,
  options: string[] = [],
  deps: { classifier?: ClassifierModel; jobId?: number } = {},
): Promise<MatchedAnswer | null> {
  const q = normalizeQuestion(questionText);
  if (!q) return null;
  const bank = await prisma.answer.findMany({ where: { approved: true, reusable: true }, orderBy: { id: "asc" } });
  if (bank.length === 0) return null;

  // exact first, then the longest matching pattern (most specific wins)
  const exact = bank.find((a) => a.questionText === q);
  if (exact) {
    const value = usable(answerValue(exact), fieldType, options);
    if (value) return { answerId: exact.id, value, via: "exact" };
  }
  let best: { a: Answer; len: number } | null = null;
  for (const a of bank) {
    for (const p of [a.questionText, ...a.patterns]) {
      if (patternApplies(q, p, fieldType) && (!best || p.length > best.len)) best = { a, len: p.length };
    }
  }
  if (best) {
    const value = usable(answerValue(best.a), fieldType, options);
    if (value) return { answerId: best.a.id, value, via: "pattern" };
  }

  // classifier: keys + question texts only
  const classifier = deps.classifier ?? (process.env.ANTHROPIC_API_KEY ? claudeClassifier : null);
  if (!classifier) return null;
  const choices = bank.map((a) => ({ key: a.key ?? `a${a.id}`, question: a.questionText, a }));
  const user = `Saved questions:\n${choices.map((c) => `- ${c.key}: ${c.question}`).join("\n")}\n\nForm question: ${questionText}`;
  const result = await classifier(CLASSIFIER_SYSTEM, user);
  // log BEFORE validating (we paid for the tokens either way)
  await prisma.aiCall.create({
    data: { purpose: "match_question", model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, jobId: deps.jobId ?? null },
  });
  const parsed = classifierSchema.safeParse(result.output);
  if (!parsed.success) return null;
  const hit = choices.find((c) => c.key === parsed.data.key); // an unknown key (hallucination) = unmatched
  if (!hit) return null;
  const value = usable(answerValue(hit.a), fieldType, options);
  return value ? { answerId: hit.a.id, value, via: "classifier" } : null;
}
