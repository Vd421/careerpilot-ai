import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { Router } from "express";
import { z } from "zod";
import {
  AGENT_ACTION_TYPES,
  HARD_DAILY_CAP,
  SOURCE_IDS,
  type ActivityItem,
  type AttentionItem,
  type OverviewResponse,
  type ResumeVariantItem,
  type SourceStatus,
  type StatusResponse,
} from "../contracts.js";
import { SOURCE_META } from "../discovery/meta.js";
import { prisma } from "../db.js";
import type { Prisma } from "../generated/prisma/client.js";
import { resolveRepoPath } from "../tailor/paths.js";
import type { ApiDeps } from "./deps.js";
import { HttpError, notFound, parse, parseId } from "./errors.js";
import { activityInclude, toActivityItem, toSettingsDto } from "./mappers.js";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function getSettings() {
  return prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

const activityQuery = z.object({
  type: z.enum(AGENT_ACTION_TYPES).optional(),
  jobId: z.coerce.number().int().positive().optional(),
  applicationId: z.coerce.number().int().positive().optional(),
  loopId: z.coerce.number().int().positive().optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const settingsPatch = z
  .object({
    salaryFloors: z.record(z.string(), z.number().nonnegative()),
    noticeDays: z.number().int().min(0).max(365),
    matchThreshold: z.number().int().min(0).max(100),
    maxYearsRequired: z.number().int().min(0).max(50),
    sources: z.partialRecord(z.enum(SOURCE_IDS), z.boolean()),
    dailyCap: z.number().int().min(0),
    maxScoresPerDay: z.number().int().min(0).max(1000),
    maxTailorsPerDay: z.number().int().min(0).max(1000),
    dryRun: z.boolean(),
  })
  .partial(); // unknown keys (e.g. telegramLinked) are ignored

export function miscRouter(deps: ApiDeps): Router {
  const r = Router();

  r.get("/status", async (_req, res) => {
    const s = await getSettings();
    const body: StatusResponse = {
      telegramConnected: await deps.isTelegramConnected(),
      appliedToday: await prisma.application.count({ where: { appliedAt: { gte: startOfToday() } } }),
      dailyCap: Math.min(s.dailyCap, HARD_DAILY_CAP),
      dryRun: s.dryRun,
    };
    res.json(body);
  });

  r.get("/overview", async (_req, res) => {
    const [discovered, scored, pushed, approved, applied, replied] = await Promise.all([
      prisma.job.count(),
      prisma.job.count({ where: { scoredAt: { not: null } } }),
      prisma.application.count(),
      prisma.application.count({ where: { approvedAt: { not: null } } }),
      prisma.application.count({ where: { status: { in: ["applied", "replied", "interview", "rejected", "offer"] } } }),
      prisma.application.count({ where: { status: { in: ["replied", "interview", "offer"] } } }),
    ]);

    // Things waiting on me
    const attention: AttentionItem[] = [];
    const apps = await prisma.application.findMany({
      where: {
        OR: [
          { status: { in: ["pending_approval", "manual"] } },
          { status: "approved", filledAt: { not: null }, submitApprovedAt: null },
        ],
      },
      include: { job: true },
      orderBy: { id: "desc" },
      take: 50,
    });
    for (const a of apps) {
      const kind = a.status === "pending_approval" ? "approval" : a.status === "manual" ? "manual" : "submit";
      attention.push({
        kind,
        id: a.id,
        title: `${a.job.title} at ${a.job.company}`,
        subtitle:
          kind === "approval" ? "Waiting for your [Apply] tap" : kind === "manual" ? `Apply by hand (${a.manualReason ?? "manual"})` : "Filled, ready to submit",
        createdAt: a.createdAt.toISOString(),
      });
    }
    const questions = await prisma.question.findMany({
      where: { status: { in: ["pending", "asked"] }, application: { status: { notIn: ["skipped"] } } },
      include: { application: { include: { job: true } } },
      orderBy: { id: "desc" },
      take: 50,
    });
    for (const q of questions) {
      attention.push({
        kind: "question",
        id: q.id,
        title: q.text,
        subtitle: `${q.application.job.title} at ${q.application.job.company}`,
        createdAt: q.createdAt.toISOString(),
      });
    }
    attention.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const recent = await prisma.agentAction.findMany({ orderBy: { id: "desc" }, take: 10, include: activityInclude });
    const body: OverviewResponse = {
      stats: { discovered, applied, awaitingMe: attention.length, replies: replied },
      funnel: [
        { stage: "discovered", count: discovered },
        { stage: "scored", count: scored },
        { stage: "pushed", count: pushed },
        { stage: "approved", count: approved },
        { stage: "applied", count: applied },
        { stage: "replied", count: replied },
      ],
      attention,
      recentActivity: recent.map(toActivityItem),
    };
    res.json(body);
  });

  r.get("/activity", async (req, res) => {
    const q = parse(activityQuery, req.query);
    const where: Prisma.AgentActionWhereInput = {
      ...(q.type && { type: q.type }),
      ...(q.jobId && { jobId: q.jobId }),
      ...(q.applicationId && { applicationId: q.applicationId }),
      ...(q.loopId && { loopId: q.loopId }),
      ...(q.before && { id: { lt: q.before } }),
    };
    const rows = await prisma.agentAction.findMany({
      where,
      orderBy: { id: "desc" },
      take: q.limit,
      include: activityInclude,
    });
    const items: ActivityItem[] = rows.map(toActivityItem);
    res.json(items);
  });

  r.get("/resume-variants", async (_req, res) => {
    const rows = await prisma.resumeVariant.findMany({ orderBy: { id: "asc" } });
    const items: ResumeVariantItem[] = rows.map((v) => ({ id: v.id, name: v.name, filePath: v.filePath }));
    res.json(items);
  });

  r.get("/sources", async (_req, res) => {
    const s = await getSettings();
    const enabled = (s.sources ?? {}) as Record<string, boolean>;
    const items: SourceStatus[] = SOURCE_IDS.map((id) => {
      const meta = SOURCE_META[id];
      return { ...meta, enabled: enabled[id] !== false, configured: meta.needsKey ? Boolean(process.env[meta.needsKey]) : true };
    });
    res.json(items);
  });

  r.get("/settings", async (_req, res) => {
    res.json(toSettingsDto(await getSettings()));
  });

  r.put("/settings", async (req, res) => {
    const patch = parse(settingsPatch, req.body);
    const before = await getSettings();

    const data: Prisma.SettingsUpdateInput = {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const apply = <K extends keyof typeof patch>(key: K, current: unknown, next: unknown, set: () => void) => {
      if (next === undefined || JSON.stringify(current) === JSON.stringify(next)) return;
      changes[key] = { from: current, to: next };
      set();
    };

    // The 15/day limit is a hard rule: clamp, never trust the client.
    const dailyCap = patch.dailyCap === undefined ? undefined : Math.min(patch.dailyCap, HARD_DAILY_CAP);
    apply("dailyCap", before.dailyCap, dailyCap, () => (data.dailyCap = dailyCap));
    apply("salaryFloors", before.salaryFloors, patch.salaryFloors, () => (data.salaryFloors = patch.salaryFloors));
    apply("noticeDays", before.noticeDays, patch.noticeDays, () => (data.noticeDays = patch.noticeDays));
    apply("matchThreshold", before.matchThreshold, patch.matchThreshold, () => (data.matchThreshold = patch.matchThreshold));
    apply("maxYearsRequired", before.maxYearsRequired, patch.maxYearsRequired, () => (data.maxYearsRequired = patch.maxYearsRequired));
    apply("maxScoresPerDay", before.maxScoresPerDay, patch.maxScoresPerDay, () => (data.maxScoresPerDay = patch.maxScoresPerDay));
    apply("maxTailorsPerDay", before.maxTailorsPerDay, patch.maxTailorsPerDay, () => (data.maxTailorsPerDay = patch.maxTailorsPerDay));
    apply("dryRun", before.dryRun, patch.dryRun, () => (data.dryRun = patch.dryRun));
    // sources merge key by key, so toggling one source doesn't forget the others
    const mergedSources = patch.sources ? { ...(before.sources as object), ...patch.sources } : undefined;
    apply("sources", before.sources, mergedSources, () => (data.sources = mergedSources));

    if (Object.keys(changes).length === 0) {
      res.json(toSettingsDto(before));
      return;
    }
    const after = await prisma.settings.update({ where: { id: 1 }, data });

    const loud = changes.dryRun?.to === false;
    if (loud) console.warn("[settings] DRY_RUN TURNED OFF from the dashboard: applications can now be submitted after a [Submit] tap");
    await prisma.agentAction.create({
      data: {
        type: "settings.updated",
        detail: { changes, ...(loud && { warning: "dryRun turned OFF: real submissions are now possible (still needs a Telegram [Submit] tap per application)" }) } as Prisma.InputJsonObject,
      },
    });
    res.json(toSettingsDto(after));
  });

  // ---- files ----
  // PDF of a tailored resume. Rendered on first request if it doesn't exist yet.
  r.get("/resume-versions/:id/pdf", async (req, res) => {
    const id = parseId(req.params.id);
    const v = await prisma.resumeVersion.findUnique({ where: { id } });
    if (!v) notFound("Resume version");
    let rel = v.pdfPath;
    if (!rel || !existsSync(resolveRepoPath(rel))) rel = (await deps.renderResumePdf(id)).pdfPath;
    res.type("application/pdf").sendFile(resolveRepoPath(rel));
  });

  // basename only + must already exist in the screenshots dir: no way to walk out of it.
  r.get("/screenshots/:file", (req, res) => {
    const file = String(req.params.file);
    if (file !== basename(file) || file.includes("\\") || file.startsWith(".")) {
      throw new HttpError(400, "Invalid file name");
    }
    const abs = join(deps.screenshotsDir, file);
    if (!existsSync(abs)) notFound("Screenshot");
    res.sendFile(abs);
  });

  return r;
}
