import { Router } from "express";
import { z } from "zod";
import { QUEUES, type ApplicationStatus, type RefineResponse, type ResumeChatMessageItem } from "../contracts.js";
import { prisma } from "../db.js";
import type { ApiDeps } from "./deps.js";
import { HttpError, notFound, parse, parseId } from "./errors.js";
import { activeVersionId, toResumeVersionItem } from "./mappers.js";

const refineBody = z.object({
  message: z.string().trim().min(1).max(1000),
  baseVersionId: z.number().int().positive().optional(),
});

// Once a form was submitted, the resume that went out is history: no more edits.
const SENT: ApplicationStatus[] = ["applied", "replied", "interview", "rejected", "offer"];

type ChatRow = { id: number; role: string; text: string; resumeVersionId: number | null; createdAt: Date };
const toMessage = (m: ChatRow): ResumeChatMessageItem => ({
  id: m.id,
  role: m.role as "user" | "assistant",
  text: m.text,
  resumeVersionId: m.resumeVersionId,
  createdAt: m.createdAt.toISOString(),
});

// Refuses edits after submit / during a submit. Returns the application so callers can refresh a filled form.
async function guardApplication(jobId: number) {
  const app = await prisma.application.findUnique({ where: { jobId } });
  if (app && SENT.includes(app.status as ApplicationStatus)) {
    throw new HttpError(409, "This application was already sent, so its resume can't change");
  }
  if (app?.submitLockedAt) throw new HttpError(409, "A submit is in progress for this application");
  return app;
}

// A form already filled with the old resume (waiting on [Submit], or a dry run) must not be submitted with a
// resume I never saw in the screenshot: clear the fill and the [Submit] tap, and fill again with the new PDF.
async function refillIfFilled(deps: ApiDeps, app: Awaited<ReturnType<typeof guardApplication>>) {
  if (!app || app.status !== "approved" || !app.filledAt) return;
  await prisma.application.update({ where: { id: app.id }, data: { filledAt: null, submitApprovedAt: null } });
  await deps.enqueue(QUEUES.fill, { applicationId: app.id }, { singletonKey: `fill:${app.id}` });
}

export function resumeChatRouter(deps: ApiDeps): Router {
  const r = Router();

  r.get("/jobs/:id/resume-chat", async (req, res) => {
    const jobId = parseId(req.params.id);
    if (!(await prisma.job.findUnique({ where: { id: jobId } }))) notFound("Job");
    const rows = await prisma.resumeChatMessage.findMany({ where: { jobId }, orderBy: { id: "asc" } });
    res.json(rows.map(toMessage));
  });

  r.post("/jobs/:id/resume-chat", async (req, res) => {
    const jobId = parseId(req.params.id);
    const body = parse(refineBody, req.body);
    if (!(await prisma.job.findUnique({ where: { id: jobId } }))) notFound("Job");
    const app = await guardApplication(jobId);

    const baseId = body.baseVersionId ?? (await activeVersionId(jobId));
    if (!baseId) throw new HttpError(400, "Tailor the resume for this job first, then refine it here");
    const firstNewId = ((await prisma.resumeChatMessage.findFirst({ orderBy: { id: "desc" }, select: { id: true } }))?.id ?? 0) + 1;

    const { resumeVersionId } = await deps.refineResume(jobId, body.message, baseId);
    let version = null;
    if (resumeVersionId) {
      await deps.renderResumePdf(resumeVersionId);
      await refillIfFilled(deps, app);
      const v = await prisma.resumeVersion.findUniqueOrThrow({ where: { id: resumeVersionId }, include: { variant: true } });
      version = toResumeVersionItem(v, await activeVersionId(jobId));
    }
    const messages = await prisma.resumeChatMessage.findMany({ where: { jobId, id: { gte: firstNewId } }, orderBy: { id: "asc" } });
    const out: RefineResponse = { messages: messages.map(toMessage), version };
    res.json(out);
  });

  // Make an older version current again: a copy becomes the newest, so history stays linear. No AI call.
  r.post("/resume-versions/:id/restore", async (req, res) => {
    const id = parseId(req.params.id);
    const old = await prisma.resumeVersion.findUnique({ where: { id } });
    if (!old) notFound("Resume version");
    const app = await guardApplication(old.jobId);

    const copy = await prisma.resumeVersion.create({
      data: { jobId: old.jobId, variantId: old.variantId, parentId: old.id, tailored: old.tailored ?? {} },
    });
    if (app) await prisma.application.update({ where: { id: app.id }, data: { resumeVersionId: copy.id } });
    await deps.renderResumePdf(copy.id);
    await refillIfFilled(deps, app);
    await prisma.resumeChatMessage.create({
      data: { jobId: old.jobId, role: "assistant", text: `Restored version #${old.id}.`, resumeVersionId: copy.id },
    });
    await prisma.agentAction.create({
      data: {
        type: "resume.restored",
        jobId: old.jobId,
        applicationId: app?.id ?? null,
        detail: { resumeVersionId: copy.id, restoredFrom: old.id },
      },
    });
    const v = await prisma.resumeVersion.findUniqueOrThrow({ where: { id: copy.id }, include: { variant: true } });
    res.json(toResumeVersionItem(v, await activeVersionId(old.jobId)));
  });

  return r;
}
