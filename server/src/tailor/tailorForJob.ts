import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getClaude, MODELS, type ModelResult } from "../ai/client.js";
import type { TailoredResume } from "../contracts.js";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db.js";
import { loadResume } from "../resume/load.js";
import { buildTailorPrompt, TAILOR_SYSTEM_PROMPT } from "./prompt.js";
import { resolveRepoPath } from "./paths.js";
import { tailoredResumeSchema } from "./schema.js";
import { validateTailored } from "./validate.js";

export class TailorError extends Error {
  name = "TailorError";
}

export class TailorCapError extends TailorError {
  name = "TailorCapError";
}

// Same idea as ScoringModel: the real one calls Claude, tests pass a fake (no cost).
export type TailorModel = (system: string, user: string) => Promise<ModelResult>;

export const claudeTailorModel: TailorModel = async (system, user) => {
  // No `thinking` option: Sonnet 5.5 can't have it disabled, so we leave it unset.
  const response = await getClaude().messages.parse({
    model: MODELS.better,
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { format: zodOutputFormat(tailoredResumeSchema) },
  });
  return {
    output: response.parsed_output,
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    stopReason: response.stop_reason,
  };
};

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

const MAX_ATTEMPTS = 2; // first try + one retry with the violations appended

export async function runTailor(
  jobId: number,
  variantId: number | undefined,
  model: TailorModel = claudeTailorModel,
): Promise<{ resumeVersionId: number }> {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId }, include: { application: true } });

  // Which base resume: explicit > the one the application was assigned (A/B) > the first variant.
  const wanted = variantId ?? job.application?.resumeVariantId ?? undefined;
  const variant = wanted
    ? await prisma.resumeVariant.findUnique({ where: { id: wanted } })
    : await prisma.resumeVariant.findFirst({ orderBy: { id: "asc" } });
  if (!variant) throw new TailorError("No resume variant found. Run `npm run db:seed` first.");
  const resume = loadResume(resolveRepoPath(variant.filePath));

  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const cap = settings?.maxTailorsPerDay ?? 20;

  let violations: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Each model call costs money, so the cap is checked before every call, retries included.
    const today = await prisma.aiCall.count({ where: { purpose: "tailor", createdAt: { gte: startOfToday() } } });
    if (today >= cap) throw new TailorCapError(`Daily tailor cap reached (${cap})`);

    const prompt = buildTailorPrompt(job, resume, job.matchedSkills, job.missingSkills, violations);
    const result = await model(TAILOR_SYSTEM_PROMPT, prompt);

    // Log BEFORE validating: the tokens are spent either way.
    await prisma.aiCall.create({
      data: {
        purpose: "tailor",
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        jobId,
      },
    });

    const parsed = tailoredResumeSchema.safeParse(result.output);
    violations = parsed.success
      ? validateTailored(parsed.data, resume)
      : [`Output did not match the schema (stop_reason: ${result.stopReason})`];

    if (parsed.success && violations.length === 0) {
      const tailored: TailoredResume = parsed.data;
      const version = await prisma.resumeVersion.create({
        data: { jobId, variantId: variant.id, tailored: tailored as unknown as Prisma.InputJsonValue },
      });
      // The application (if any) uses the newest tailored version.
      if (job.application) {
        await prisma.application.update({ where: { id: job.application.id }, data: { resumeVersionId: version.id } });
      }
      await prisma.agentAction.create({
        data: {
          type: "resume.tailored",
          jobId,
          applicationId: job.application?.id ?? null,
          loopId: job.loopId,
          detail: { resumeVersionId: version.id, variantId: variant.id, variantName: variant.name, attempt },
        },
      });
      return { resumeVersionId: version.id };
    }

    await prisma.agentAction.create({
      data: {
        type: "resume.tailor_rejected",
        jobId,
        applicationId: job.application?.id ?? null,
        loopId: job.loopId,
        detail: { attempt, violations },
      },
    });
  }

  throw new TailorError(`Tailored resume rejected after ${MAX_ATTEMPTS} attempts: ${violations.join("; ")}`);
}
