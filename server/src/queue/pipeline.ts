import {
  QUEUES,
  type Enqueue,
  type FilterSettings,
  type LoopFilters,
  type RawJob,
  type RunDiscovery,
  type SendJobCard,
  type SourceId,
} from "../contracts.js";
import { prisma } from "../db.js";
import { applyFilters, dedupeKey, passesThreshold } from "../filters/index.js";
import type { Prisma } from "../generated/prisma/client.js";
import { ensureApplication } from "./push.js";

// Everything the pipeline needs from outside, injected so tests use fakes (no network, no Claude, no Telegram).
export interface PipelineDeps {
  runDiscovery: RunDiscovery;
  enqueue: Enqueue;
  // Scores one job and saves the score on the job row (the real one is scoreJob + the resume file).
  scoreJob: (jobId: number) => Promise<{ matchScore: number }>;
  sendJobCard: SendJobCard;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function getSettings() {
  return prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

export function toFilterSettings(s: Prisma.SettingsGetPayload<object>): FilterSettings {
  return {
    salaryFloors: (s.salaryFloors ?? {}) as Record<string, number>,
    noticeDays: s.noticeDays,
    matchThreshold: s.matchThreshold,
    maxYearsRequired: s.maxYearsRequired,
  };
}

async function scoresToday(): Promise<number> {
  return prisma.aiCall.count({ where: { purpose: "score", createdAt: { gte: startOfToday() } } });
}

export interface LoopRunSummary {
  found: number;
  deduped: number;
  inserted: number;
  filteredOut: number;
  scoreEnqueued: number;
  scoreSkippedForCap: number;
}

// ---------------------------------------------------------------------------
// loop.run: discover -> dedupe -> insert -> filters -> enqueue scoring (capped)
// ---------------------------------------------------------------------------
export async function runLoop(loopId: number, deps: PipelineDeps): Promise<LoopRunSummary | null> {
  const loop = await prisma.loop.findUnique({ where: { id: loopId } });
  if (!loop || !loop.active) return null; // paused/deleted between scheduling and running

  const settings = await getSettings();
  const filterSettings = toFilterSettings(settings);
  const loopFilters = (loop.filters ?? {}) as LoopFilters;
  const enabledMap = (settings.sources ?? {}) as Record<string, boolean>;
  const sources = (loop.sources as SourceId[]).filter((s) => enabledMap[s] !== false);

  await prisma.agentAction.create({
    data: { type: "loop.run_started", loopId, detail: { sources } },
  });

  const summary: LoopRunSummary = {
    found: 0,
    deduped: 0,
    inserted: 0,
    filteredOut: 0,
    scoreEnqueued: 0,
    scoreSkippedForCap: 0,
  };

  try {
    const raws: RawJob[] = sources.length
      ? await deps.runDiscovery({ keywords: loop.keywords, locations: loop.locations }, sources)
      : [];
    summary.found = raws.length;

    const toScore: number[] = [];

    for (const raw of raws) {
      const key = dedupeKey(raw.company, raw.title, raw.url);
      const existing = await prisma.job.findUnique({ where: { dedupeKey: key }, select: { id: true } });
      if (existing) {
        summary.deduped++;
        await prisma.agentAction.create({
          data: { type: "job.deduped", jobId: existing.id, loopId, detail: { source: raw.source, dedupeKey: key } },
        });
        continue;
      }

      const verdict = applyFilters(raw, filterSettings, loopFilters);
      let job;
      try {
        job = await prisma.job.create({
          data: {
            company: raw.company,
            title: raw.title,
            url: raw.url,
            description: raw.description,
            source: raw.source,
            externalId: raw.externalId,
            dedupeKey: key,
            location: raw.location,
            remote: raw.remote,
            postedAt: raw.postedAt ? new Date(raw.postedAt) : null,
            applyPlatform: raw.applyPlatform,
            salaryMin: raw.salaryMin,
            salaryMax: raw.salaryMax,
            salaryCurrency: raw.salaryCurrency,
            loopId,
            tags: verdict.tags,
            stage: verdict.keep ? "discovered" : "filtered_out",
            filterReasons: verdict.reasons,
          },
        });
      } catch (err) {
        // Two runs inserted the same job at once: the unique dedupeKey caught it. Count it as a duplicate.
        if ((err as { code?: string }).code === "P2002") {
          summary.deduped++;
          continue;
        }
        throw err;
      }
      summary.inserted++;
      await prisma.agentAction.create({
        data: { type: "job.discovered", jobId: job.id, loopId, detail: { source: raw.source, title: raw.title, company: raw.company } },
      });

      if (!verdict.keep) {
        summary.filteredOut++;
        await prisma.agentAction.create({
          data: { type: "job.filtered_out", jobId: job.id, loopId, detail: { reasons: verdict.reasons } },
        });
        continue;
      }
      toScore.push(job.id);
    }

    // Jobs left unscored by an earlier run (daily cap hit) go first: they've waited longest.
    const backlog = await prisma.job.findMany({
      where: { loopId, stage: "discovered", scoredAt: null, id: { notIn: toScore } },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    const queue = [...backlog.map((j) => j.id), ...toScore];

    let budget = Math.max(0, settings.maxScoresPerDay - (await scoresToday()));
    for (const jobId of queue) {
      if (budget <= 0) {
        summary.scoreSkippedForCap++;
        continue; // stays "discovered"; the next run's backlog pass picks it up
      }
      budget--;
      summary.scoreEnqueued++;
      await deps.enqueue(QUEUES.scoreJob, { jobId }, { singletonKey: `score:${jobId}` });
    }
    if (summary.scoreSkippedForCap > 0) {
      // Logged once per run, not once per job.
      console.warn(
        `[loop ${loopId}] daily score cap (${settings.maxScoresPerDay}) reached; ${summary.scoreSkippedForCap} jobs left unscored until tomorrow`,
      );
    }
  } catch (err) {
    await prisma.agentAction.create({
      data: { type: "loop.run_finished", loopId, detail: { ...summary, error: (err as Error).message } },
    });
    throw err;
  }

  await prisma.loop.update({ where: { id: loopId }, data: { lastRunAt: new Date() } });
  await prisma.agentAction.create({
    data: { type: "loop.run_finished", loopId, detail: { ...summary, capReached: summary.scoreSkippedForCap > 0 } },
  });
  return summary;
}

// ---------------------------------------------------------------------------
// job.score: score, then threshold -> stage "scored", and good matches go on to job.push
// ---------------------------------------------------------------------------
export async function scoreStep(jobId: number, deps: PipelineDeps): Promise<"scored" | "skipped" | "capped"> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, include: { loop: true } });
  // Retried or duplicate message: already scored or filtered, nothing to do (and no second Claude bill).
  if (!job || job.scoredAt !== null || job.stage === "filtered_out") return "skipped";

  const settings = await getSettings();
  if ((await scoresToday()) >= settings.maxScoresPerDay) {
    console.warn(`[score] daily score cap (${settings.maxScoresPerDay}) reached; job ${jobId} stays unscored`);
    return "capped"; // not an error: throwing would make pg-boss retry and hit the cap again
  }

  const { matchScore } = await deps.scoreJob(jobId);
  await prisma.agentAction.create({
    data: { type: "job.scored", jobId, loopId: job.loopId, detail: { matchScore } },
  });
  await prisma.job.updateMany({ where: { id: jobId, stage: "discovered" }, data: { stage: "scored" } });

  const loopFilters = (job.loop?.filters ?? {}) as LoopFilters;
  if (passesThreshold(matchScore, settings, loopFilters)) {
    await deps.enqueue(QUEUES.pushJob, { jobId }, { singletonKey: `push:${jobId}` });
  }
  return "scored";
}

// ---------------------------------------------------------------------------
// job.push: create the Application (once) and send the Telegram card
// ---------------------------------------------------------------------------
export async function pushStep(jobId: number, deps: PipelineDeps, opts: { force?: boolean } = {}): Promise<void> {
  const { application } = await ensureApplication(jobId);
  if (application.status !== "pending_approval") return; // already decided; never re-ask

  if (!opts.force) {
    // A retried job.push must not send the same card twice.
    const sent = await prisma.agentAction.count({ where: { type: "telegram.card_sent", applicationId: application.id } });
    if (sent > 0) return;
  }
  await deps.sendJobCard(application.id);
}
