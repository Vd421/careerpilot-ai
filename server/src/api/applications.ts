import { Router } from "express";
import { z } from "zod";
import { APPLICATION_STATUSES, QUESTION_STATUSES, canTransition, type ApplicationStatus } from "../contracts.js";
import { prisma } from "../db.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { ApiDeps } from "./deps.js";
import { HttpError, notFound, parse, parseId } from "./errors.js";
import {
  applicationInclude,
  questionInclude,
  toAnswerItem,
  toApplicationDetail,
  toApplicationListItem,
  toQuestionItem,
} from "./mappers.js";

const appsQuery = z.object({
  status: z.enum(APPLICATION_STATUSES).optional(),
  loopId: z.coerce.number().int().positive().optional(),
});
const questionsQuery = z.object({ status: z.enum(QUESTION_STATUSES).optional() });
const answerBody = z.object({ rawAnswer: z.string().trim().min(1).max(5000) });
const approveBody = z
  .object({
    choice: z.enum(["polished", "original", "edited"]),
    edited: z.string().trim().min(1).max(5000).optional(),
    reusable: z.boolean(),
  })
  .refine((b) => b.choice !== "edited" || b.edited, { message: "edited text is required when choice is 'edited'" });
const answerPatch = z
  .object({
    key: z.string().trim().min(1).max(100).nullable(),
    questionText: z.string().trim().min(1).max(1000),
    rawAnswer: z.string().trim().min(1).max(5000),
    polishedAnswer: z.string().trim().min(1).max(5000).nullable(),
    approved: z.boolean(),
    reusable: z.boolean(),
    tags: z.array(z.string().trim().min(1).max(50)).max(20),
  })
  .partial();

export function applicationsRouter(deps: ApiDeps): Router {
  const r = Router();

  // ---- applications ----
  r.get("/applications", async (req, res) => {
    const q = parse(appsQuery, req.query);
    const rows = await prisma.application.findMany({
      where: { ...(q.status && { status: q.status }), ...(q.loopId && { loopId: q.loopId }) },
      orderBy: { id: "desc" },
      include: applicationInclude,
    });
    res.json(rows.map(toApplicationListItem));
  });

  r.get("/applications/:id", async (req, res) => {
    const id = parseId(req.params.id);
    const app = await prisma.application.findUnique({ where: { id }, include: applicationInclude });
    if (!app) notFound("Application");
    const questions = await prisma.question.findMany({
      where: { applicationId: id },
      orderBy: { id: "asc" },
      include: questionInclude,
    });
    res.json(toApplicationDetail(app, questions));
  });

  // Manual path: the bot gave me link + PDF + answers and I applied myself. Nothing is submitted by us.
  r.post("/applications/:id/mark-applied", async (req, res) => {
    const id = parseId(req.params.id);
    const app = await prisma.application.findUnique({ where: { id } });
    if (!app) notFound("Application");
    const from = app.status as ApplicationStatus;
    if (!canTransition(from, "applied")) throw new HttpError(409, `Cannot mark a ${from} application as applied`);
    await prisma.application.update({
      where: { id },
      data: { status: "applied", method: "manual", appliedAt: new Date() },
    });
    await prisma.agentAction.create({
      data: {
        type: "application.marked_applied",
        jobId: app.jobId,
        applicationId: id,
        loopId: app.loopId,
        detail: { manual: true, by: "me", via: "dashboard" },
      },
    });
    res.status(204).end();
  });

  // ---- questions ----
  r.get("/questions", async (req, res) => {
    const q = parse(questionsQuery, req.query);
    const rows = await prisma.question.findMany({
      where: q.status ? { status: q.status } : {},
      orderBy: { id: "desc" },
      include: questionInclude,
    });
    res.json(rows.map(toQuestionItem));
  });

  r.post("/questions/:id/answer", async (req, res) => {
    const id = parseId(req.params.id);
    const { rawAnswer } = parse(answerBody, req.body);
    if (!(await prisma.question.findUnique({ where: { id } }))) notFound("Question");
    res.json(await deps.submitRawAnswer(id, rawAnswer));
  });

  r.post("/questions/:id/approve", async (req, res) => {
    const id = parseId(req.params.id);
    const b = parse(approveBody, req.body);
    if (!(await prisma.question.findUnique({ where: { id } }))) notFound("Question");
    await deps.approveAnswer(id, b.choice === "edited" ? { edited: b.edited! } : b.choice, b.reusable);
    res.status(204).end();
  });

  // ---- answer bank ----
  r.get("/answers", async (_req, res) => {
    res.json((await prisma.answer.findMany({ orderBy: { updatedAt: "desc" } })).map(toAnswerItem));
  });

  r.patch("/answers/:id", async (req, res) => {
    const id = parseId(req.params.id);
    const patch = parse(answerPatch, req.body) as Prisma.AnswerUpdateInput;
    if (!(await prisma.answer.findUnique({ where: { id } }))) notFound("Answer");
    res.json(toAnswerItem(await prisma.answer.update({ where: { id }, data: patch })));
  });

  r.delete("/answers/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (!(await prisma.answer.findUnique({ where: { id } }))) notFound("Answer");
    await prisma.answer.delete({ where: { id } });
    res.status(204).end();
  });

  return r;
}
