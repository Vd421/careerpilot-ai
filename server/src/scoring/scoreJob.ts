import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getClaude, MODELS, type ModelResult } from "../ai/client.js";
import { prisma } from "../db.js";
import type { Resume } from "../resume/schema.js";
import { buildScoringPrompt, SCORING_SYSTEM_PROMPT } from "./prompt.js";
import { scoreSchema, type Score } from "./schema.js";

export class ScoringError extends Error {
  name = "ScoringError";
}

// Anything that takes a prompt and returns a ModelResult.
// The real one calls Claude; tests pass in a fake one (no cost, same answer every time).
export type ScoringModel = (system: string, user: string) => Promise<ModelResult>;

export const claudeScoringModel: ScoringModel = async (system, user) => {
  const response = await getClaude().messages.parse({
    model: MODELS.cheap,
    max_tokens: 1024, // a score is short; cap it so a runaway answer can't cost much
    system,
    messages: [{ role: "user", content: user }],
    output_config: { format: zodOutputFormat(scoreSchema) },
  });

  return {
    output: response.parsed_output, // null if the answer didn't fit the schema
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    stopReason: response.stop_reason,
  };
};

export async function scoreJob(
  jobId: number,
  resume: Resume,
  model: ScoringModel = claudeScoringModel,
): Promise<Score> {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });

  const result = await model(SCORING_SYSTEM_PROMPT, buildScoringPrompt(job.description, resume));

  // Log BEFORE validating: we paid for these tokens even if the answer turns out bad.
  await prisma.aiCall.create({
    data: {
      purpose: "score",
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      jobId,
    },
  });

  // Never trust model output blindly, even with structured outputs.
  const parsed = scoreSchema.safeParse(result.output);
  if (!parsed.success) {
    throw new ScoringError(
      `Invalid score from model (stop_reason: ${result.stopReason}): ${parsed.error.message}`,
    );
  }

  const score = parsed.data;
  await prisma.job.update({
    where: { id: jobId },
    data: { ...score, scoredAt: new Date() },
  });

  return score;
}
