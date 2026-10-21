import type { Application } from "../generated/prisma/client.js";
import { prisma } from "../db.js";

// A/B rotation: of the loop's resume variants, use the one with the fewest applications so far.
// Ties go to the earlier variant in the loop's list. No loop / no variants -> null (tailor falls back to the first).
export async function pickVariantId(loopId: number | null): Promise<number | null> {
  if (loopId == null) return null;
  const loop = await prisma.loop.findUnique({ where: { id: loopId } });
  if (!loop || loop.resumeVariantIds.length === 0) return null;

  const counts = await prisma.application.groupBy({
    by: ["resumeVariantId"],
    where: { loopId, resumeVariantId: { in: loop.resumeVariantIds } },
    _count: { _all: true },
  });
  const countOf = new Map(counts.map((c) => [c.resumeVariantId, c._count._all]));

  let best = loop.resumeVariantIds[0];
  for (const id of loop.resumeVariantIds) {
    if ((countOf.get(id) ?? 0) < (countOf.get(best) ?? 0)) best = id;
  }
  return best;
}

// Creates the Application for a job exactly once. The unique idempotencyKey ("apply:<jobId>") means
// a retried queue job or a double click on [Push] can never create a second one.
export async function ensureApplication(jobId: number): Promise<{ application: Application; created: boolean }> {
  const key = `apply:${jobId}`;
  const existing = await prisma.application.findUnique({ where: { idempotencyKey: key } });
  if (existing) return { application: existing, created: false };

  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
  const resumeVariantId = await pickVariantId(job.loopId);
  // A resume tailored (or refined) from the dashboard before the card went out is the one to use.
  // Without this, [Apply] would pay to tailor again.
  const newest = await prisma.resumeVersion.findFirst({ where: { jobId }, orderBy: { id: "desc" }, select: { id: true } });
  try {
    const application = await prisma.application.create({
      data: {
        jobId,
        loopId: job.loopId,
        resumeVariantId,
        resumeVersionId: newest?.id ?? null,
        idempotencyKey: key,
        status: "pending_approval",
      },
    });
    await prisma.job.update({ where: { id: jobId }, data: { stage: "pushed" } });
    await prisma.agentAction.create({
      data: {
        type: "job.pushed",
        jobId,
        applicationId: application.id,
        loopId: job.loopId,
        detail: { resumeVariantId },
      },
    });
    return { application, created: true };
  } catch (err) {
    // Lost a race with a concurrent push: the other one created it, so use that row.
    const again = await prisma.application.findUnique({ where: { idempotencyKey: key } });
    if (again) return { application: again, created: false };
    throw err;
  }
}
