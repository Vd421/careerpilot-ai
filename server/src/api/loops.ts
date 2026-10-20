import { Router } from "express";
import { z } from "zod";
import { QUEUES, SOURCE_IDS, type LoopDetail, type LoopStats, type VariantStats } from "../contracts.js";
import { prisma } from "../db.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { ApiDeps } from "./deps.js";
import { HttpError, notFound, parse, parseId } from "./errors.js";
import { computeStats, isValidCron, toLoopItem } from "./mappers.js";

const floors = z.record(z.string(), z.number().nonnegative());
const loopInput = z.object({
  name: z.string().trim().min(1).max(100),
  keywords: z.array(z.string().trim().min(1)).min(1).max(30),
  locations: z.array(z.string().trim().min(1)).max(30),
  sources: z.array(z.enum(SOURCE_IDS)).min(1),
  filters: z
    .object({
      minScore: z.number().int().min(0).max(100).optional(),
      salaryFloors: floors.optional(),
      remoteOnly: z.boolean().optional(),
      excludeKeywords: z.array(z.string().trim().min(1)).max(50).optional(),
    })
    .default({}),
  resumeVariantIds: z.array(z.number().int().positive()).max(2).default([]),
  schedule: z
    .string()
    .trim()
    .default("0 */6 * * *")
    .refine(isValidCron, { message: "schedule must be a valid cron expression" }),
});
const loopPatch = loopInput.partial();

async function statsFor(where: { loopId: number; resumeVariantId?: number }, found: number): Promise<LoopStats> {
  const apps = await prisma.application.findMany({ where, select: { status: true, approvedAt: true } });
  return computeStats(found, apps);
}

export function loopsRouter(deps: ApiDeps): Router {
  const r = Router();

  async function item(id: number) {
    const loop = await prisma.loop.findUnique({ where: { id } });
    if (!loop) notFound("Loop");
    const found = await prisma.job.count({ where: { loopId: id } });
    return toLoopItem(loop, await statsFor({ loopId: id }, found));
  }

  async function checkVariants(ids: number[]) {
    if (new Set(ids).size !== ids.length) throw new HttpError(400, "resumeVariantIds has duplicates");
    const found = await prisma.resumeVariant.count({ where: { id: { in: ids } } });
    if (found !== ids.length) throw new HttpError(400, "Unknown resume variant id");
  }

  async function uniqueName(name: string, exceptId?: number) {
    const clash = await prisma.loop.findUnique({ where: { name } });
    if (clash && clash.id !== exceptId) throw new HttpError(409, `A loop named "${name}" already exists`);
  }

  r.get("/loops", async (_req, res) => {
    const loops = await prisma.loop.findMany({ orderBy: { id: "asc" } });
    res.json(await Promise.all(loops.map((l) => item(l.id))));
  });

  r.post("/loops", async (req, res) => {
    const b = parse(loopInput, req.body);
    await uniqueName(b.name);
    await checkVariants(b.resumeVariantIds);
    const loop = await prisma.loop.create({ data: { ...b, filters: b.filters as Prisma.InputJsonObject } });
    await deps.syncLoopSchedules();
    res.status(201).json(await item(loop.id));
  });

  r.get("/loops/:id", async (req, res) => {
    const id = parseId(req.params.id);
    const base = await item(id);
    const variants = await prisma.resumeVariant.findMany({
      where: { id: { in: base.resumeVariantIds } },
      orderBy: { id: "asc" },
    });
    const perVariant: VariantStats[] = [];
    for (const v of variants) {
      const found = await prisma.job.count({ where: { loopId: id, application: { is: { resumeVariantId: v.id } } } });
      perVariant.push({
        variantId: v.id,
        variantName: v.name,
        ...(await statsFor({ loopId: id, resumeVariantId: v.id }, found)),
      });
    }
    const detail: LoopDetail = { ...base, variants: perVariant };
    res.json(detail);
  });

  r.patch("/loops/:id", async (req, res) => {
    const id = parseId(req.params.id);
    const b = parse(loopPatch, req.body);
    if (!(await prisma.loop.findUnique({ where: { id } }))) notFound("Loop");
    if (b.name) await uniqueName(b.name, id);
    if (b.resumeVariantIds) await checkVariants(b.resumeVariantIds);
    await prisma.loop.update({
      where: { id },
      data: { ...b, ...(b.filters && { filters: b.filters as Prisma.InputJsonObject }) },
    });
    await deps.syncLoopSchedules();
    res.json(await item(id));
  });

  r.post("/loops/:id/pause", async (req, res) => {
    const id = parseId(req.params.id);
    if (!(await prisma.loop.findUnique({ where: { id } }))) notFound("Loop");
    await prisma.loop.update({ where: { id }, data: { active: false } });
    await prisma.agentAction.create({ data: { type: "loop.paused", loopId: id, detail: { via: "dashboard" } } });
    await deps.syncLoopSchedules();
    res.json(await item(id));
  });

  r.post("/loops/:id/resume", async (req, res) => {
    const id = parseId(req.params.id);
    if (!(await prisma.loop.findUnique({ where: { id } }))) notFound("Loop");
    await prisma.loop.update({ where: { id }, data: { active: true } });
    await prisma.agentAction.create({ data: { type: "loop.resumed", loopId: id, detail: { via: "dashboard" } } });
    await deps.syncLoopSchedules();
    res.json(await item(id));
  });

  // Run now. Same pipeline as the cron run.
  r.post("/loops/:id/run", async (req, res) => {
    const id = parseId(req.params.id);
    if (!(await prisma.loop.findUnique({ where: { id } }))) notFound("Loop");
    await deps.enqueue(QUEUES.loopRun, { loopId: id }, { singletonKey: `loop-run:${id}` });
    res.json(await item(id));
  });

  return r;
}
