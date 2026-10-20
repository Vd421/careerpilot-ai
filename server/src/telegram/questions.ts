import { CALLBACK, type InlineButton } from "../contracts.js";
import { prisma } from "../db.js";
import { logAction } from "./log.js";
import type { TelegramSender } from "./types.js";

// Sends one form question to me. The message is saved with its questionId, so my reply
// (swipe-reply to it) can be matched back to the question.
export async function askQuestionWith(client: TelegramSender, questionId: number): Promise<void> {
  const q = await prisma.question.findUniqueOrThrow({
    where: { id: questionId },
    include: { application: { include: { job: true } } },
  });
  const job = q.application.job;
  const lines = [
    `Question for ${job.title} at ${job.company}${q.required ? " (required)" : ""}:`,
    q.text,
    q.options.length ? `Options: ${q.options.join(" / ")}` : null,
    "Reply to this message with your answer.",
  ].filter((l): l is string => Boolean(l));

  await client.sendMessage(lines.join("\n"), undefined, { applicationId: q.applicationId, questionId });
  await prisma.question.update({ where: { id: questionId }, data: { status: "asked", askedVia: "telegram" } });
  await logAction("question.asked", { jobId: job.id, applicationId: q.applicationId }, { questionId, text: q.text });
}

// "Your answer / polished" card with the three choices from the spec.
export function answerChoiceButtons(questionId: number, polishedUsable: boolean): InlineButton[][] {
  const row: InlineButton[] = [];
  if (polishedUsable) row.push({ text: "Use", data: CALLBACK.useAnswer(questionId) });
  row.push({ text: "Edit", data: CALLBACK.editAnswer(questionId) });
  row.push({ text: "Use my original", data: CALLBACK.useOriginal(questionId) });
  return [row];
}

// After [Use]/[Use my original]: should the answer be reused on future jobs?
// Callback: ans_save:<questionId>:<p|o>:<y|n>  (not in contracts.ts; defined here, parsed in handlers.ts)
export const saveCallback = (questionId: number, choice: "p" | "o", reusable: boolean) =>
  `ans_save:${questionId}:${choice}:${reusable ? "y" : "n"}`;

export function reuseButtons(questionId: number, choice: "p" | "o"): InlineButton[][] {
  return [
    [
      { text: "Yes", data: saveCallback(questionId, choice, true) },
      { text: "Only this job", data: saveCallback(questionId, choice, false) },
    ],
  ];
}
