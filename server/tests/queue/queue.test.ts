import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../../src/db.js";
import { resetDb } from "../helpers/resetDb.js";
import { pushStep, runLoop, scoreStep, type PipelineDeps } from "../../src/queue/pipeline.js";
import { createRuntime, syncSchedules, type ScheduleApi, type WorkerDeps } from "../../src/queue/runtime.js";
import { ensureApplication } from "../../src/queue/push.js";
import type { RawJob } from "../../src/contracts.js";

function raw(n: number, over: Partial<RawJob> = {}): RawJob {
  return {
    source: "remotive",
    externalId: String(n),
    company: `Co${n}`,
    title: `Software Engineer ${n}`,
    url: `https://jobs.example.com/${n}`,
    description: "Build APIs with Node.",
    location: "Remote",
    remote: true,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    postedAt: null,
    applyPlatform: "other",
    ...over,
  };
}

function fakes(opts: { discovered?: RawJob[]; score?: number } = {}) {
  const calls = {
    enqueue: [] as [string, Record<string, unknown>][],
    cards: [] as number[],
    discovery: [] as { keywords: string[]; sources: string[] }[],
    scored: [] as number[],
  };
  const deps: PipelineDeps = {
    runDiscovery: async (q, sources) => {
      calls.discovery.push({ keywords: q.keywords, sources });
      return opts.discovered ?? [];
    },
    enqueue: async (name, data) => void calls.enqueue.push([name, data]),
    scoreJob: async (jobId) => {
      calls.scored.push(jobId);
      const matchScore = opts.score ?? 80;
      await prisma.job.update({ where: { id: jobId }, data: { matchScore, scoredAt: new Date() } });
      return { matchScore };
    },
    sendJobCard: async (id) => {
      calls.cards.push(id);
      const app = await prisma.application.findUniqueOrThrow({ where: { id } });
      await prisma.agentAction.create({ data: { type: "telegram.card_sent", jobId: app.jobId, applicationId: id } });
    },
  };
  return { deps, calls };
}

async function mkLoop(over: Record<string, unknown> = {}) {
  return prisma.loop.create({
    data: { name: "L", keywords: ["node"], locations: ["Remote"], sources: ["remotive", "greenhouse"], ...over },
  });
}
async function mkVariants() {
  const a = await prisma.resumeVariant.create({ data: { name: "A", filePath: "x.json" } });
  const b = await prisma.resumeVariant.create({ data: { name: "B", filePath: "y.json" } });
  return { a, b };
}
const types = async () => (await prisma.agentAction.findMany({ orderBy: { id: "asc" } })).map((x) => x.type);

beforeEach(async () => {
  await resetDb();
  await prisma.settings.create({ data: { id: 1 } });
});
afterAll(() => prisma.$disconnect());

describe("runLoop", () => {
  it("inserts jobs, tags them, logs actions and enqueues scoring", async () => {
    const loop = await mkLoop();
    const { deps, calls } = fakes({ discovered: [raw(1), raw(2)] });
    const summary = await runLoop(loop.id, deps);

    expect(summary).toMatchObject({ found: 2, inserted: 2, deduped: 0, filteredOut: 0, scoreEnqueued: 2 });
    const jobs = await prisma.job.findMany({ orderBy: { id: "asc" } });
    expect(jobs.map((j) => [j.stage, j.loopId, j.tags])).toEqual([
      ["discovered", loop.id, ["salary_unknown"]],
      ["discovered", loop.id, ["salary_unknown"]],
    ]);
    expect(calls.enqueue.map((e) => e[0])).toEqual(["job.score", "job.score"]);
    expect(await types()).toEqual(["loop.run_started", "job.discovered", "job.discovered", "loop.run_finished"]);
    expect((await prisma.loop.findUniqueOrThrow({ where: { id: loop.id } })).lastRunAt).not.toBeNull();
  });

  it("dedupes against existing jobs (and logs job.deduped), without scoring again", async () => {
    const loop = await mkLoop();
    const first = fakes({ discovered: [raw(1), raw(2)] });
    await runLoop(loop.id, first.deps);
    await prisma.job.updateMany({ data: { stage: "scored", scoredAt: new Date() } });

    // same jobs again, with a tracking param and different casing on the title, plus one new
    const second = fakes({ discovered: [raw(1, { url: "https://jobs.example.com/1?utm=x" }), raw(2, { title: "SOFTWARE ENGINEER 2" }), raw(3)] });
    const summary = await runLoop(loop.id, second.deps);
    expect(summary).toMatchObject({ found: 3, deduped: 2, inserted: 1, scoreEnqueued: 1 });
    expect(await prisma.job.count()).toBe(3);
    expect(await prisma.agentAction.count({ where: { type: "job.deduped" } })).toBe(2);
  });

  it("filtered jobs get stage filtered_out with reasons and are never scored", async () => {
    const loop = await mkLoop();
    const { deps, calls } = fakes({
      discovered: [raw(1, { title: "Senior Engineer" }), raw(2, { salaryMax: 100, salaryCurrency: "INR", salaryMin: 50 }), raw(3)],
    });
    const summary = await runLoop(loop.id, deps);
    expect(summary).toMatchObject({ inserted: 3, filteredOut: 2, scoreEnqueued: 1 });
    const filtered = await prisma.job.findMany({ where: { stage: "filtered_out" }, orderBy: { id: "asc" } });
    expect(filtered).toHaveLength(2);
    expect(filtered[0].filterReasons[0]).toMatch(/Senior/);
    expect(filtered[1].filterReasons[0]).toMatch(/below/);
    expect(calls.enqueue).toHaveLength(1);
    expect(await prisma.agentAction.count({ where: { type: "job.filtered_out" } })).toBe(2);
  });

  it("applies the loop's own filters", async () => {
    const loop = await mkLoop({ filters: { remoteOnly: true, excludeKeywords: ["intern"] } });
    const { deps } = fakes({ discovered: [raw(1, { remote: false }), raw(2, { title: "Software Intern" }), raw(3)] });
    expect(await runLoop(loop.id, deps)).toMatchObject({ filteredOut: 2, scoreEnqueued: 1 });
  });

  it("respects maxScoresPerDay: extras stay discovered, and the next run picks them up", async () => {
    const loop = await mkLoop();
    await prisma.settings.update({ where: { id: 1 }, data: { maxScoresPerDay: 2 } });
    const run1 = fakes({ discovered: [raw(1), raw(2), raw(3)] });
    expect(await runLoop(loop.id, run1.deps)).toMatchObject({ inserted: 3, scoreEnqueued: 2, scoreSkippedForCap: 1 });
    const finished = await prisma.agentAction.findFirstOrThrow({ where: { type: "loop.run_finished" } });
    expect(finished.detail).toMatchObject({ capReached: true });
    expect(await prisma.job.count({ where: { stage: "discovered" } })).toBe(3);

    // pretend those two got scored, then a later run with a higher cap enqueues the waiting third
    await prisma.settings.update({ where: { id: 1 }, data: { maxScoresPerDay: 10 } });
    await prisma.job.updateMany({ where: { id: { in: [1, 2] } }, data: { stage: "scored", scoredAt: new Date() } });
    const run2 = fakes({ discovered: [] });
    expect(await runLoop(loop.id, run2.deps)).toMatchObject({ scoreEnqueued: 1 });
    expect(run2.calls.enqueue[0]).toEqual(["job.score", { jobId: 3 }]);
  });

  it("score calls already made today count against the cap", async () => {
    const loop = await mkLoop();
    await prisma.settings.update({ where: { id: 1 }, data: { maxScoresPerDay: 2 } });
    await prisma.aiCall.createMany({ data: [1, 2].map(() => ({ purpose: "score", model: "m", inputTokens: 1, outputTokens: 1 })) });
    const { deps, calls } = fakes({ discovered: [raw(1)] });
    expect(await runLoop(loop.id, deps)).toMatchObject({ scoreEnqueued: 0, scoreSkippedForCap: 1 });
    expect(calls.enqueue).toHaveLength(0);
  });

  it("a paused loop does nothing; disabled sources are not queried", async () => {
    const paused = await mkLoop({ active: false });
    const f = fakes({ discovered: [raw(1)] });
    expect(await runLoop(paused.id, f.deps)).toBeNull();
    expect(f.calls.discovery).toHaveLength(0);
    expect(await runLoop(9999, f.deps)).toBeNull();

    const loop = await mkLoop({ name: "L2" });
    await prisma.settings.update({ where: { id: 1 }, data: { sources: { remotive: false } } });
    await runLoop(loop.id, f.deps);
    expect(f.calls.discovery[0].sources).toEqual(["greenhouse"]);
  });

  it("logs run_finished with the error when discovery throws, then rethrows", async () => {
    const loop = await mkLoop();
    const f = fakes();
    f.deps.runDiscovery = async () => {
      throw new Error("boom");
    };
    await expect(runLoop(loop.id, f.deps)).rejects.toThrow("boom");
    const fin = await prisma.agentAction.findFirstOrThrow({ where: { type: "loop.run_finished" } });
    expect(fin.detail).toMatchObject({ error: "boom" });
  });
});

describe("scoreStep", () => {
  async function mkJob(over: Record<string, unknown> = {}) {
    return prisma.job.create({ data: { company: "A", title: "B", description: "C", ...over } });
  }

  it("scores, sets stage scored and enqueues push when above threshold", async () => {
    const j = await mkJob();
    const { deps, calls } = fakes({ score: 80 });
    expect(await scoreStep(j.id, deps)).toBe("scored");
    expect((await prisma.job.findUniqueOrThrow({ where: { id: j.id } })).stage).toBe("scored");
    expect(calls.enqueue).toEqual([["job.push", { jobId: j.id }]]);
    expect(await types()).toEqual(["job.scored"]);
  });

  it("below the threshold: scored but not pushed", async () => {
    const j = await mkJob();
    const { deps, calls } = fakes({ score: 40 });
    await scoreStep(j.id, deps);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: j.id } })).stage).toBe("scored");
    expect(calls.enqueue).toHaveLength(0);
  });

  it("the loop's minScore overrides the global threshold", async () => {
    const loop = await mkLoop({ filters: { minScore: 90 } });
    const j = await mkJob({ loopId: loop.id });
    const { deps, calls } = fakes({ score: 80 }); // global threshold is 65, loop wants 90
    await scoreStep(j.id, deps);
    expect(calls.enqueue).toHaveLength(0);
  });

  it("is idempotent: an already scored or filtered job is not scored again", async () => {
    const scored = await mkJob({ scoredAt: new Date(), matchScore: 70 });
    const filtered = await mkJob({ title: "X", stage: "filtered_out" });
    const { deps, calls } = fakes();
    expect(await scoreStep(scored.id, deps)).toBe("skipped");
    expect(await scoreStep(filtered.id, deps)).toBe("skipped");
    expect(await scoreStep(9999, deps)).toBe("skipped");
    expect(calls.scored).toHaveLength(0);
  });

  it("does not call the model once the daily cap is reached", async () => {
    const j = await mkJob();
    await prisma.settings.update({ where: { id: 1 }, data: { maxScoresPerDay: 1 } });
    await prisma.aiCall.create({ data: { purpose: "score", model: "m", inputTokens: 1, outputTokens: 1 } });
    const { deps, calls } = fakes();
    expect(await scoreStep(j.id, deps)).toBe("capped");
    expect(calls.scored).toHaveLength(0);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: j.id } })).stage).toBe("discovered");
  });
});

describe("pushStep and A/B rotation", () => {
  async function mkJob(n: number, loopId: number | null) {
    return prisma.job.create({ data: { company: `C${n}`, title: "T", description: "D", loopId } });
  }

  it("creates a pending_approval application, sets stage pushed, sends one card", async () => {
    const loop = await mkLoop();
    const j = await mkJob(1, loop.id);
    const { deps, calls } = fakes();
    await pushStep(j.id, deps);

    const app = await prisma.application.findUniqueOrThrow({ where: { jobId: j.id } });
    expect(app).toMatchObject({ status: "pending_approval", idempotencyKey: `apply:${j.id}`, loopId: loop.id, approvedAt: null });
    expect((await prisma.job.findUniqueOrThrow({ where: { id: j.id } })).stage).toBe("pushed");
    expect(calls.cards).toEqual([app.id]);
    expect(await prisma.agentAction.count({ where: { type: "job.pushed" } })).toBe(1);
  });

  it("is idempotent: a retried push creates no second application and sends no second card", async () => {
    const j = await mkJob(1, null);
    const { deps, calls } = fakes();
    await pushStep(j.id, deps);
    await pushStep(j.id, deps);
    await Promise.all([ensureApplication(j.id), ensureApplication(j.id)]);
    expect(await prisma.application.count()).toBe(1);
    expect(calls.cards).toHaveLength(1);
    expect(await prisma.agentAction.count({ where: { type: "job.pushed" } })).toBe(1);
  });

  it("force resends the card (dashboard push)", async () => {
    const j = await mkJob(1, null);
    const { deps, calls } = fakes();
    await pushStep(j.id, deps);
    await pushStep(j.id, deps, { force: true });
    expect(calls.cards).toHaveLength(2);
  });

  it("never re-asks about an application that is already decided", async () => {
    const j = await mkJob(1, null);
    const { deps, calls } = fakes();
    await ensureApplication(j.id);
    await prisma.application.update({ where: { jobId: j.id }, data: { status: "skipped" } });
    await pushStep(j.id, deps, { force: true });
    expect(calls.cards).toHaveLength(0);
  });

  it("rotates resume variants: the one with the fewest applications wins", async () => {
    const { a, b } = await mkVariants();
    const loop = await mkLoop({ resumeVariantIds: [a.id, b.id] });
    const { deps } = fakes();
    const used: number[] = [];
    for (let i = 1; i <= 5; i++) {
      const j = await mkJob(i, loop.id);
      await pushStep(j.id, deps);
      used.push((await prisma.application.findUniqueOrThrow({ where: { jobId: j.id } })).resumeVariantId!);
    }
    expect(used).toEqual([a.id, b.id, a.id, b.id, a.id]);
  });

  it("a single-variant loop always uses it; no variants -> null", async () => {
    const { a } = await mkVariants();
    const one = await mkLoop({ name: "one", resumeVariantIds: [a.id] });
    const none = await mkLoop({ name: "none" });
    const { deps } = fakes();
    const j1 = await mkJob(1, one.id);
    const j2 = await mkJob(2, none.id);
    await pushStep(j1.id, deps);
    await pushStep(j2.id, deps);
    expect((await prisma.application.findUniqueOrThrow({ where: { jobId: j1.id } })).resumeVariantId).toBe(a.id);
    expect((await prisma.application.findUniqueOrThrow({ where: { jobId: j2.id } })).resumeVariantId).toBeNull();
  });
});

describe("syncSchedules", () => {
  function fakeApi(existing: string[] = []) {
    const scheduled = new Map<string, { cron: string; data: object }>();
    const removed: string[] = [];
    const api: ScheduleApi = {
      getSchedules: async () => existing.map((key) => ({ key })),
      schedule: async (_name, cron, data, opts) => void scheduled.set(opts.key, { cron, data }),
      unschedule: async (_name, key) => void removed.push(key),
    };
    return { api, scheduled, removed };
  }

  it("schedules every active loop and unschedules paused or deleted ones", async () => {
    const active = await mkLoop({ name: "a", schedule: "0 9 * * *" });
    const paused = await mkLoop({ name: "b", active: false });
    const { api, scheduled, removed } = fakeApi([`loop-${paused.id}`, "loop-999", `loop-${active.id}`]);
    await syncSchedules(api);
    expect([...scheduled.keys()]).toEqual([`loop-${active.id}`]);
    expect(scheduled.get(`loop-${active.id}`)).toEqual({ cron: "0 9 * * *", data: { loopId: active.id } });
    expect(removed.sort()).toEqual([`loop-${paused.id}`, "loop-999"].sort());
  });

  it("picks up a changed cron on the next sync", async () => {
    const loop = await mkLoop({ schedule: "0 9 * * *" });
    const f = fakeApi();
    await syncSchedules(f.api);
    await prisma.loop.update({ where: { id: loop.id }, data: { schedule: "0 12 * * *" } });
    await syncSchedules(f.api);
    expect(f.scheduled.get(`loop-${loop.id}`)?.cron).toBe("0 12 * * *");
  });
});

describe("runtime with real pg-boss", () => {
  it("delivers an enqueued job.push to its worker, then stops cleanly", async () => {
    const j = await prisma.job.create({ data: { company: "A", title: "B", description: "C" } });
    const { deps, calls } = fakes();
    const workerDeps: WorkerDeps = { ...deps, tailorAndRender: async () => {}, prescan: async () => {}, fill: async () => {} };
    const rt = createRuntime(workerDeps, process.env.DATABASE_URL!, 0.5);

    await expect(rt.enqueue("job.push", { jobId: j.id })).rejects.toThrow(/not started/);
    await rt.start();
    try {
      await rt.enqueue("job.push", { jobId: j.id });
      const deadline = Date.now() + 20_000;
      while (calls.cards.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
      expect(calls.cards).toHaveLength(1);
      expect(await prisma.application.count()).toBe(1);
    } finally {
      await rt.stop();
    }
    expect(rt.isStarted()).toBe(false);
  }, 60_000);
});
