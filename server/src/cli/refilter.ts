// Usage: npm run jobs:refilter
// Re-applies the current filters (Settings + each Loop's filters) to jobs that haven't been scored yet.
// Run it after changing filters, so the unscored backlog matches them. Costs nothing: no AI calls.
import "dotenv/config";
import type { LoopFilters } from "../contracts.js";
import { prisma } from "../db.js";
import { applyFilters } from "../filters/index.js";
import { toFilterSettings } from "../queue/pipeline.js";

try {
  const settings = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
  const filterSettings = toFilterSettings(settings);
  const jobs = await prisma.job.findMany({
    where: { stage: { in: ["discovered", "filtered_out"] }, scoredAt: null },
    include: { loop: true },
  });

  let dropped = 0;
  let restored = 0;
  for (const job of jobs) {
    const loopFilters: LoopFilters | undefined = job.loop
      ? { ...(job.loop.filters as LoopFilters), locations: job.loop.locations }
      : undefined;
    const verdict = applyFilters(job, filterSettings, loopFilters);
    const stage = verdict.keep ? "discovered" : "filtered_out";
    if (stage !== job.stage) {
      if (stage === "filtered_out") dropped++;
      else restored++;
    }
    await prisma.job.update({
      where: { id: job.id },
      data: { stage, tags: verdict.tags, filterReasons: verdict.reasons },
    });
  }
  console.log(`Re-filtered ${jobs.length} unscored jobs: ${dropped} now filtered out, ${restored} restored.`);
} finally {
  await prisma.$disconnect();
}
