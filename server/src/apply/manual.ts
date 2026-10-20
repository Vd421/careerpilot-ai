import { existsSync } from "node:fs";
import { canTransition, type ApplicationStatus, type ManualReason } from "../contracts.js";
import { prisma } from "../db.js";
import { resolveRepoPath } from "../tailor/paths.js";
import { logAction } from "../telegram/log.js";
import { approvedValue, standardValues } from "./plan.js";
import type { ApplyDeps } from "./types.js";

const REASON_TEXT: Record<ManualReason, string> = {
  captcha: "there is a CAPTCHA",
  unknown_form: "I couldn't read the form",
  unsupported_platform: "this site isn't Greenhouse, Lever or Ashby",
  unanswered: "some required questions have no answer",
  daily_cap: "the daily application cap was reached",
  error: "something went wrong",
};

const CHUNK = 3500; // Telegram messages max out at 4096 characters

function chunks(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur.length + line.length + 1 > CHUNK && cur) {
      out.push(cur);
      cur = "";
    }
    cur += (cur ? "\n" : "") + line;
  }
  if (cur) out.push(cur);
  return out;
}

// The manual path: I apply myself, so give me everything in one place: link, PDF, and every known answer as copyable text.
export async function goManual(deps: ApplyDeps, applicationId: number, reason: ManualReason, note?: string): Promise<void> {
  const app = await prisma.application.findUniqueOrThrow({
    where: { id: applicationId },
    include: { job: true, resumeVersion: true, questions: { orderBy: { id: "asc" }, include: { answer: true } } },
  });
  const from = app.status as ApplicationStatus;
  if (from !== "manual" && !canTransition(from, "manual")) {
    console.warn(`[apply] application ${applicationId}: cannot go ${from} -> manual`);
    return;
  }
  await prisma.application.update({
    where: { id: applicationId },
    data: { status: "manual", method: "manual", manualReason: reason, ...(note ? { lastError: note } : {}) },
  });
  await logAction("application.manual", { jobId: app.jobId, applicationId, loopId: app.loopId }, { reason, note: note ?? null });

  const ctx = { applicationId };
  const header = [
    `Apply manually: ${app.job.title} at ${app.job.company}`,
    `Why: ${REASON_TEXT[reason]}${note ? ` (${note})` : ""}`,
    app.job.url ?? "(no link saved)",
  ].join("\n");
  await deps.telegram.sendMessage(header, undefined, ctx);

  const pdf = app.resumeVersion?.pdfPath ? resolveRepoPath(app.resumeVersion.pdfPath) : null;
  if (pdf && existsSync(pdf)) {
    await deps.telegram.sendDocument(pdf, `Resume for ${app.job.title} at ${app.job.company}`, ctx);
  }

  // Answers: standard fields from resume.json, then every question (bank, Telegram or dashboard answers).
  const lines: string[] = [];
  try {
    const std = standardValues(await deps.loadResume(app.resumeVariantId));
    const labels: [string, string | undefined][] = [
      ["Name", std.full_name], ["Email", std.email], ["Phone", std.phone],
      ["LinkedIn", std.linkedin], ["GitHub", std.github], ["Website", std.website],
    ];
    for (const [label, value] of labels) if (value) lines.push(`${label}: ${value}`);
  } catch (err) {
    console.warn(`[apply] couldn't load resume for manual answers: ${(err as Error).message}`);
  }
  for (const q of app.questions) {
    const value = approvedValue(q);
    lines.push(`${q.text}${q.required ? " *" : ""}: ${value ?? "(no answer yet)"}`);
  }
  if (lines.length) {
    for (const part of chunks(`Answers you can copy:\n${lines.join("\n")}`)) {
      await deps.telegram.sendMessage(part, undefined, ctx);
    }
  }
}
