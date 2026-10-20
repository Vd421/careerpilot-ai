import { existsSync } from "node:fs";
import { matchAnswer } from "../answers/index.js";
import { AUTO_APPLY_PLATFORMS, CALLBACK, QUEUES, canTransition, type ApplicationStatus, type FormField } from "../contracts.js";
import { prisma } from "../db.js";
import { resolveRepoPath } from "../tailor/paths.js";
import { logAction } from "../telegram/log.js";
import { goManual } from "./manual.js";
import { standardKeyOf } from "./prescan.js";
import { standardValues } from "./plan.js";
import type { ApplyDeps } from "./types.js";

async function isTailorCapError(err: unknown): Promise<boolean> {
  const { TailorCapError } = await import("../tailor/index.js");
  return err instanceof TailorCapError;
}
async function isTailorError(err: unknown): Promise<boolean> {
  const { TailorError } = await import("../tailor/index.js");
  return err instanceof TailorError;
}

// Makes sure this application has a tailored resume AND a PDF on disk. Returns false if it could not (already reported to me).
async function ensureResume(deps: ApplyDeps, applicationId: number): Promise<boolean> {
  const app = await prisma.application.findUniqueOrThrow({ where: { id: applicationId }, include: { resumeVersion: true, job: true } });
  try {
    let version = app.resumeVersion;
    if (!version) {
      const { resumeVersionId } = await deps.tailorForJob(app.jobId, app.resumeVariantId ?? undefined);
      version = await prisma.resumeVersion.findUniqueOrThrow({ where: { id: resumeVersionId } });
      if (!app.resumeVersionId) await prisma.application.update({ where: { id: applicationId }, data: { resumeVersionId: version.id } });
    }
    if (!version.pdfPath || !existsSync(resolveRepoPath(version.pdfPath))) {
      await deps.renderResumePdf(version.id);
    }
    return true;
  } catch (err) {
    if (await isTailorCapError(err)) {
      // The tailor cap is a spending guard. Undo my tap so I can press [Apply] again tomorrow.
      await prisma.application.update({ where: { id: applicationId }, data: { approvedAt: null } });
      await deps.telegram.sendMessage(
        `Daily tailor cap reached, so I can't make a resume for ${app.job.title} at ${app.job.company} today. Tap Apply again later.`,
        [[{ text: "Apply", data: CALLBACK.apply(applicationId) }]],
        { applicationId },
      );
      await logAction("apply.failed", { jobId: app.jobId, applicationId }, { error: "daily tailor cap reached" });
      return false;
    }
    if (await isTailorError(err)) {
      await logAction("apply.failed", { jobId: app.jobId, applicationId }, { error: (err as Error).message });
      await goManual(deps, applicationId, "error", `resume tailoring failed: ${(err as Error).message}`);
      return false;
    }
    throw err;
  }
}

// Which form fields become Question rows: every REQUIRED field I have no standard value for,
// plus optional fields the answer bank can fill (so reusable facts like notice period are filled for free).
export async function startApplication(applicationId: number, deps: ApplyDeps): Promise<void> {
  const app = await prisma.application.findUnique({ where: { id: applicationId }, include: { job: true } });
  if (!app) return;
  const status = app.status as ApplicationStatus;
  // Hard rule: nothing happens before my [Apply] tap. Retried jobs on finished applications are no-ops.
  if (!app.approvedAt) {
    console.warn(`[apply] application ${applicationId} has no approvedAt, refusing to start`);
    return;
  }
  if (status !== "pending_approval" && status !== "needs_answers") return;

  if (!(await ensureResume(deps, applicationId))) return;

  // Platform check comes after the resume so the manual message can include the PDF.
  const platform = app.job.applyPlatform as (typeof AUTO_APPLY_PLATFORMS)[number] | "other";
  if (!AUTO_APPLY_PLATFORMS.includes(platform)) {
    await goManual(deps, applicationId, "unsupported_platform");
    return;
  }
  if (!app.job.url) {
    await goManual(deps, applicationId, "unknown_form", "no link saved for this job");
    return;
  }

  const scan = await deps.filler.prescan(app.job.url, platform);
  await logAction("form.prescanned", { jobId: app.jobId, applicationId }, { ok: scan.ok, blocker: scan.blocker, fields: scan.fields.length });

  const resume = await deps.loadResume(app.resumeVariantId);
  const std = standardValues(resume);
  await createQuestions(deps, applicationId, app.jobId, scan.fields, std);

  if (scan.blocker) {
    await goManual(deps, applicationId, scan.blocker);
    return;
  }

  // Any required question still without an approved answer? Send them all at once, then wait for me.
  const open = await prisma.question.findMany({
    where: { applicationId, required: true, OR: [{ answerId: null }, { answer: { approved: false } }] },
    orderBy: { id: "asc" },
  });
  if (open.length > 0) {
    if (status === "pending_approval") await prisma.application.update({ where: { id: applicationId }, data: { status: "needs_answers" } });
    await deps.telegram.sendMessage(
      `${open.length} question${open.length > 1 ? "s" : ""} for ${app.job.title} at ${app.job.company}. Reply to each message with your answer.`,
      undefined,
      { applicationId },
    );
    for (const q of open) {
      if (q.status === "pending") await deps.askQuestion(q.id); // already-asked ones are not asked twice on a retry
    }
    return;
  }

  if (canTransition(status, "approved")) await prisma.application.update({ where: { id: applicationId }, data: { status: "approved" } });
  await deps.enqueue(QUEUES.fill, { applicationId }, { singletonKey: `fill:${applicationId}` });
}

async function createQuestions(
  deps: ApplyDeps,
  applicationId: number,
  jobId: number,
  fields: FormField[],
  std: ReturnType<typeof standardValues>,
): Promise<void> {
  const existing = new Set((await prisma.question.findMany({ where: { applicationId }, select: { fieldName: true } })).map((q) => q.fieldName));
  for (const f of fields) {
    if (existing.has(f.name)) continue; // a retry never duplicates questions
    const key = standardKeyOf(f);
    if (key === "phone_country" || key === "resume" || key === "cover_letter") continue;
    if (f.type === "file") continue; // we can only upload the resume
    if (key && std[key]) continue; // answered from resume.json

    const match = await matchAnswer(f.label, f.type, f.options, { classifier: deps.classifier, jobId });
    if (!match && !f.required) continue; // optional and unknown: leave it blank, don't bother me

    const q = await prisma.question.create({
      data: {
        applicationId,
        text: f.label,
        fieldName: f.name,
        fieldType: f.type,
        options: f.options,
        required: f.required,
        status: match ? "answered" : "pending",
        askedVia: match ? "bank" : null,
        answerId: match?.answerId ?? null,
      },
    });
    if (match) {
      await logAction("question.matched_bank", { jobId, applicationId }, { questionId: q.id, answerId: match.answerId, via: match.via });
    }
  }
}
