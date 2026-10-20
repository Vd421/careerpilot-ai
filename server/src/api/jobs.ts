import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import {
  APPLICATION_STATUSES,
  JOB_STAGES,
  QUEUES,
  SOURCE_IDS,
  canTransition,
  type ApplicationStatus,
  type ApplyPlatform,
  type CreateJobRequest,
  type RawJob,
} from "../contracts.js";
import { prisma } from "../db.js";
import type { Prisma } from "../generated/prisma/client.js";
import { dedupeKey } from "../filters/index.js";
import { ensureApplication } from "../queue/push.js";
import type { ApiDeps } from "./deps.js";
import { HttpError, notFound, parse, parseId } from "./errors.js";
import { jobDetailInclude, jobListInclude, toJobDetail, toJobListItem, toResumeVersionItem } from "./mappers.js";

const listQuery = z.object({
  stage: z.enum(JOB_STAGES).optional(),
  // status accepts an application status OR a job stage (the dashboard shows one merged "Status" column)
  status: z.enum([...APPLICATION_STATUSES, ...JOB_STAGES]).optional(),
  loopId: z.coerce.number().int().positive().optional(),
  source: z.enum(SOURCE_IDS).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const createBody = z
  .object({
    url: z.url().optional(),
    description: z.string().trim().min(20, "description is too short").max(50_000).optional(),
    company: z.string().trim().min(1).max(200).optional(),
    title: z.string().trim().min(1).max(300).optional(),
  })
  .refine((b) => b.url || b.description, { message: "Provide a url or a description" });

function platformFromUrl(url: string | undefined): ApplyPlatform {
  if (!url) return "other";
  const host = new URL(url).hostname;
  if (host.endsWith("greenhouse.io")) return "greenhouse";
  if (host.endsWith("lever.co")) return "lever";
  if (host.endsWith("ashbyhq.com")) return "ashby";
  return "other";
}

export function jobsRouter(deps: ApiDeps): Router {
  const r = Router();

  r.get("/jobs/recent", async (_req, res) => {
    const rows = await prisma.job.findMany({ orderBy: { id: "desc" }, take: 10, include: jobListInclude });
    res.json(rows.map(toJobListItem));
  });

  r.get("/jobs", async (req, res) => {
    const q = parse(listQuery, req.query);
    const where: Prisma.JobWhereInput = {};
    if (q.stage) where.stage = q.stage;
    if (q.loopId) where.loopId = q.loopId;
    if (q.source) where.source = q.source;
    if (q.q) {
      where.OR = [
        { title: { contains: q.q, mode: "insensitive" } },
        { company: { contains: q.q, mode: "insensitive" } },
      ];
    }
    if (q.status) {
      if ((APPLICATION_STATUSES as readonly string[]).includes(q.status)) {
        where.application = { is: { status: q.status } };
      } else {
        // a job stage as display status only applies while there is no application yet
        where.stage = q.status;
        where.application = { is: null };
      }
    }
    const [total, rows] = await Promise.all([
      prisma.job.count({ where }),
      prisma.job.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: jobListInclude,
      }),
    ]);
    res.json({ items: rows.map(toJobListItem), total, page: q.page, pageSize: q.pageSize });
  });

  r.get("/jobs/:id", async (req, res) => {
    const job = await prisma.job.findUnique({ where: { id: parseId(req.params.id) }, include: jobDetailInclude });
    if (!job) notFound("Job");
    res.json(toJobDetail(job));
  });

  // Paste a JD or a Greenhouse/Lever/Ashby URL. Scoring runs in the background.
  r.post("/jobs", async (req, res) => {
    const body: CreateJobRequest = parse(createBody, req.body);

    let raw: RawJob | null = null;
    if (body.url) raw = await deps.fetchJobFromUrl(body.url);
    const description = body.description ?? raw?.description;
    if (!description) {
      throw new HttpError(400, "Could not read that URL. Paste the job description instead.");
    }

    const company = body.company ?? raw?.company ?? "Unknown company";
    const title = body.title ?? raw?.title ?? "Pasted job";
    const url = raw?.url ?? body.url ?? null;
    // Without a URL, two different pasted JDs must not collapse into one: key on the text too.
    const keyUrl = url ?? `paste:${createHash("sha1").update(description).digest("hex").slice(0, 12)}`;
    const key = dedupeKey(company, title, keyUrl);

    const existing = await prisma.job.findUnique({ where: { dedupeKey: key } });
    if (existing) {
      await prisma.agentAction.create({
        data: { type: "job.deduped", jobId: existing.id, detail: { source: "manual", dedupeKey: key } },
      });
      const full = await prisma.job.findUniqueOrThrow({ where: { id: existing.id }, include: jobDetailInclude });
      res.status(200).json(toJobDetail(full));
      return;
    }

    const job = await prisma.job.create({
      data: {
        company,
        title,
        url,
        description,
        dedupeKey: key,
        source: raw?.source ?? "manual",
        externalId: raw?.externalId ?? null,
        location: raw?.location ?? null,
        remote: raw?.remote ?? null,
        postedAt: raw?.postedAt ? new Date(raw.postedAt) : null,
        applyPlatform: raw?.applyPlatform ?? platformFromUrl(url ?? undefined),
        salaryMin: raw?.salaryMin ?? null,
        salaryMax: raw?.salaryMax ?? null,
        salaryCurrency: raw?.salaryCurrency ?? null,
      },
    });
    await prisma.agentAction.create({
      data: { type: "job.discovered", jobId: job.id, detail: { source: "manual", pasted: true } },
    });
    await deps.enqueue(QUEUES.scoreJob, { jobId: job.id }, { singletonKey: `score:${job.id}` });

    const full = await prisma.job.findUniqueOrThrow({ where: { id: job.id }, include: jobDetailInclude });
    res.status(201).json(toJobDetail(full));
  });

  // Sends the Telegram card. It can NOT approve or submit: approval comes only from the Telegram tap.
  r.post("/jobs/:id/push", async (req, res) => {
    const id = parseId(req.params.id);
    if (!(await prisma.job.findUnique({ where: { id } }))) notFound("Job");

    const { application } = await ensureApplication(id);
    const status = application.status as ApplicationStatus;
    if (status === "skipped") {
      // Changed my mind: back to waiting for a tap.
      await prisma.application.update({ where: { id: application.id }, data: { status: "pending_approval" } });
    } else if (status !== "pending_approval") {
      throw new HttpError(409, `Application is already ${status}`);
    }
    await deps.enqueue(QUEUES.pushJob, { jobId: id }, { singletonKey: `push:${id}` });
    res.json({ applicationId: application.id });
  });

  r.post("/jobs/:id/tailor", async (req, res) => {
    const id = parseId(req.params.id);
    if (!(await prisma.job.findUnique({ where: { id } }))) notFound("Job");
    const { resumeVersionId } = await deps.tailorForJob(id);
    await deps.renderResumePdf(resumeVersionId);
    const v = await prisma.resumeVersion.findUniqueOrThrow({ where: { id: resumeVersionId }, include: { variant: true } });
    res.json(toResumeVersionItem(v));
  });

  r.post("/jobs/:id/skip", async (req, res) => {
    const id = parseId(req.params.id);
    const job = await prisma.job.findUnique({ where: { id }, include: { application: true } });
    if (!job) notFound("Job");

    let applicationId: number;
    if (job.application) {
      const from = job.application.status as ApplicationStatus;
      if (from === "skipped") {
        res.status(204).end();
        return;
      }
      if (!canTransition(from, "skipped")) throw new HttpError(409, `Cannot skip an application that is ${from}`);
      await prisma.application.update({ where: { id: job.application.id }, data: { status: "skipped" } });
      applicationId = job.application.id;
    } else {
      // No application yet: record the skip as one, so the job shows as skipped everywhere.
      const created = await prisma.application.create({
        data: { jobId: id, loopId: job.loopId, status: "skipped", idempotencyKey: `apply:${id}` },
      });
      applicationId = created.id;
    }
    await prisma.agentAction.create({
      data: { type: "application.skipped", jobId: id, applicationId, loopId: job.loopId, detail: { via: "dashboard" } },
    });
    res.status(204).end();
  });

  return r;
}
