import type { Enqueue } from "../contracts.js";
import { prisma } from "../db.js";
import { loadResume } from "../resume/load.js";
import { scoreJob } from "../scoring/scoreJob.js";
import { resolveRepoPath } from "../tailor/paths.js";
import { createRuntime, type Runtime, type WorkerDeps } from "./runtime.js";

export { runLoop, scoreStep, pushStep } from "./pipeline.js";
export { ensureApplication, pickVariantId } from "./push.js";
export { createRuntime, syncSchedules } from "./runtime.js";

// Specifiers for modules owned by integrations are variables, so this file compiles before they exist.
// (Swap to static imports once they land.)
const TELEGRAM = "../telegram/index.js";
const APPLY = "../apply/index.js";

// Which base resume scores a job: its application's variant, else its loop's first, else the first variant.
async function resumeFileFor(jobId: number): Promise<string> {
  const job = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    include: { application: true, loop: true },
  });
  const wanted = job.application?.resumeVariantId ?? job.loop?.resumeVariantIds[0];
  const variant = wanted
    ? await prisma.resumeVariant.findUnique({ where: { id: wanted } })
    : await prisma.resumeVariant.findFirst({ orderBy: { id: "asc" } });
  if (!variant) throw new Error("No resume variant found. Run `npm run db:seed` first.");
  return variant.filePath;
}

export const defaultWorkerDeps: WorkerDeps = {
  runDiscovery: async (...a) => (await import("../discovery/index.js")).runDiscovery(...a),
  enqueue: (...a) => enqueue(...a), // the live runtime's enqueue (defined below)
  scoreJob: async (jobId) => {
    const resume = loadResume(resolveRepoPath(await resumeFileFor(jobId)));
    return scoreJob(jobId, resume);
  },
  sendJobCard: async (id) => (await import(TELEGRAM)).sendJobCard(id),
  tailorAndRender: async (jobId, variantId) => {
    const { tailorForJob, TailorError } = await import("../tailor/index.js");
    const { renderResumePdf } = await import("../pdf/index.js");
    try {
      const { resumeVersionId } = await tailorForJob(jobId, variantId);
      await renderResumePdf(resumeVersionId);
    } catch (err) {
      // A rejected tailor already wrote its action rows. Retrying would just pay for another model call.
      if (err instanceof TailorError) {
        console.warn(`[tailor] job ${jobId}: ${err.message}`);
        return;
      }
      throw err;
    }
  },
  // Pre-scan and fill are both driven by integrations' orchestrator.
  prescan: async (id) => {
    const m = await import(APPLY);
    await (m.prescanApplication ?? m.startApplication)(id);
  },
  fill: async (id) => {
    const m = await import(APPLY);
    await (m.fillApplication ?? m.startApplication)(id);
  },
};

let runtime: Runtime | null = null;

function getRuntime(): Runtime {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  runtime ??= createRuntime(defaultWorkerDeps, url);
  return runtime;
}

export async function startQueue(opts: { workers?: boolean } = {}): Promise<void> {
  await getRuntime().start(opts);
}

export async function stopQueue(): Promise<void> {
  if (runtime) await runtime.stop();
}

// Contract: used by the API, the Telegram bot and the workers.
export const enqueue: Enqueue = (name, data, opts) => getRuntime().enqueue(name, data, opts);

// The API calls this whenever a loop is created, edited, paused or resumed.
// Before startQueue() (e.g. the web process without a worker) there's nothing to sync, and start() syncs anyway.
export async function syncLoopSchedules(): Promise<void> {
  if (runtime?.isStarted()) await runtime.syncLoopSchedules();
}
