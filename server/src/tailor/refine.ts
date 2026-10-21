import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { getClaude, MODELS } from "../ai/client.js";
import type { TailoredResume } from "../contracts.js";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db.js";
import { loadResume } from "../resume/load.js";
import { resolveRepoPath } from "./paths.js";
import { TAILOR_SYSTEM_PROMPT } from "./prompt.js";
import { tailoredResumeSchema } from "./schema.js";
import { assertTailorBudget, TailorError, type TailorModel } from "./tailorForJob.js";
import { validateTailored } from "./validate.js";

// What the model returns for one chat turn.
export const refineSchema = z.object({
  reply: z.string(),
  changed: z.boolean(),
  tailored: tailoredResumeSchema,
});

export const REFINE_SYSTEM_PROMPT = `${TAILOR_SYSTEM_PROMPT}

You are now EDITING an existing tailored version, following the candidate's chat instruction.
- Start from <current_version> and apply the instruction. Keep everything the instruction doesn't touch.
- You may move, drop or re-add bullets from the resume, reword them, reorder skills, rewrite the headline or cover note.
- If the instruction needs anything the resume doesn't contain (a new skill, tool, number, employer, outcome), do NOT
  do that part. Say so plainly in reply and suggest adding it to the master resume if it's true.
- reply: 1-3 short sentences on what you changed and anything you couldn't do. No preamble.
- changed: false if you made no change (then return <current_version> unchanged).`;

export function buildRefinePrompt(
  job: { company: string; title: string; description: string },
  resume: ReturnType<typeof loadResume>,
  current: TailoredResume,
  history: { role: string; text: string }[],
  message: string,
  violations: string[] = [],
): string {
  // Contact details stay local, same as scoring and tailoring.
  const { basics, ...rest } = resume;
  const candidate = { location: basics.location, ...rest };
  let prompt = `<resume>
${JSON.stringify(candidate, null, 2)}
</resume>

<job company="${job.company}" title="${job.title}">
${job.description}
</job>

<current_version>
${JSON.stringify(current, null, 2)}
</current_version>`;

  if (history.length > 0) {
    prompt += `

<earlier_chat>
${history.map((m) => `${m.role === "user" ? "Candidate" : "You"}: ${m.text}`).join("\n")}
</earlier_chat>`;
  }
  prompt += `

<instruction>
${message}
</instruction>`;
  if (violations.length > 0) {
    prompt += `

<previous_attempt_rejected>
Your previous answer broke these rules. Fix every one (drop that part of the instruction if needed and say so in reply):
${violations.map((v) => `- ${v}`).join("\n")}
</previous_attempt_rejected>`;
  }
  return prompt;
}

export const claudeRefineModel: TailorModel = async (system, user) => {
  const response = await getClaude().messages.parse({
    model: MODELS.better,
    max_tokens: 4000,
    // Sonnet 5.5's thinking-off mode; the validator checks the result anyway.
    thinking: { type: "between_tools" },
    system,
    messages: [{ role: "user", content: user }],
    output_config: { format: zodOutputFormat(refineSchema) },
  });
  return {
    output: response.parsed_output,
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    stopReason: response.stop_reason,
  };
};

const MAX_ATTEMPTS = 2; // first try + one retry with the violations appended
const HISTORY = 8; // earlier chat messages sent as context

// One chat turn. Saves both messages; saves a new version only if it changed AND passed the validator.
export async function runRefine(
  jobId: number,
  message: string,
  baseVersionId: number,
  model: TailorModel = claudeRefineModel,
): Promise<{ reply: string; resumeVersionId: number | null }> {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId }, include: { application: true } });
  const base = await prisma.resumeVersion.findFirst({ where: { id: baseVersionId, jobId }, include: { variant: true } });
  if (!base) throw new TailorError(`Resume version ${baseVersionId} doesn't belong to job ${jobId}`);
  const variant = base.variant ?? (await prisma.resumeVariant.findFirst({ orderBy: { id: "asc" } }));
  if (!variant) throw new TailorError("No resume variant found. Run `npm run db:seed` first.");
  const resume = loadResume(resolveRepoPath(variant.filePath));

  const history = (
    await prisma.resumeChatMessage.findMany({ where: { jobId }, orderBy: { id: "desc" }, take: HISTORY })
  ).reverse();
  await prisma.resumeChatMessage.create({ data: { jobId, role: "user", text: message } });

  const current = base.tailored as unknown as TailoredResume;
  const where = { jobId, applicationId: job.application?.id ?? null, loopId: job.loopId };
  let violations: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await assertTailorBudget();
    const result = await model(REFINE_SYSTEM_PROMPT, buildRefinePrompt(job, resume, current, history, message, violations));

    // Log BEFORE validating: the tokens are spent either way.
    await prisma.aiCall.create({
      data: { purpose: "refine", model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, jobId },
    });

    const parsed = refineSchema.safeParse(result.output);
    if (!parsed.success) {
      violations = [`Output did not match the schema (stop_reason: ${result.stopReason})`];
    } else {
      if (!parsed.data.changed) return reply(jobId, parsed.data.reply, null);
      violations = validateTailored(parsed.data.tailored, resume);
      if (violations.length === 0) {
        const version = await prisma.resumeVersion.create({
          data: {
            jobId,
            variantId: variant.id,
            parentId: base.id,
            instruction: message,
            tailored: parsed.data.tailored as unknown as Prisma.InputJsonValue,
          },
        });
        // The application (if any) uses the newest version, like a fresh tailor.
        if (job.application) {
          await prisma.application.update({ where: { id: job.application.id }, data: { resumeVersionId: version.id } });
        }
        await prisma.agentAction.create({
          data: { type: "resume.refined", ...where, detail: { resumeVersionId: version.id, parentId: base.id, instruction: message, attempt } },
        });
        return reply(jobId, parsed.data.reply, version.id);
      }
    }
    await prisma.agentAction.create({
      data: { type: "resume.refine_rejected", ...where, detail: { attempt, violations, instruction: message } },
    });
  }

  // Both attempts broke a rule: keep the current version, explain in plain words.
  const why = violations.slice(0, 2).join("; ");
  const text = `I couldn't make that change without adding something your resume doesn't say (${why}). Your current version is unchanged.`;
  return reply(jobId, text, null);
}

async function reply(jobId: number, text: string, resumeVersionId: number | null) {
  await prisma.resumeChatMessage.create({ data: { jobId, role: "assistant", text, resumeVersionId } });
  return { reply: text, resumeVersionId };
}
