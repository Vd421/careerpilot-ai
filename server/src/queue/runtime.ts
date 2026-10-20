import { PgBoss } from "pg-boss";
import { QUEUES, type Enqueue, type QueueName } from "../contracts.js";
import { prisma } from "../db.js";
import { runLoop, pushStep, scoreStep, type PipelineDeps } from "./pipeline.js";

// The owners' functions the simple workers just call (typed loosely: integrations owns the details).
export interface WorkerDeps extends PipelineDeps {
  tailorAndRender: (jobId: number, variantId?: number) => Promise<void>;
  prescan: (applicationId: number) => Promise<void>;
  fill: (applicationId: number) => Promise<void>;
}

// The tiny slice of pg-boss the scheduler needs, so the sync logic is testable with a fake.
export interface ScheduleApi {
  getSchedules(name: string): Promise<{ key: string; cron?: string }[]>;
  schedule(name: string, cron: string, data: object, opts: { key: string; tz: string }): Promise<void>;
  unschedule(name: string, key: string): Promise<void>;
}

const LOOP_KEY = (id: number) => `loop-${id}`;
// Same zone for pg-boss and for the "next run" shown in the dashboard (cron-parser uses the local zone).
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

// Make pg-boss's schedules match the DB: one cron per ACTIVE loop, nothing for paused/deleted ones.
export async function syncSchedules(api: ScheduleApi): Promise<void> {
  const loops = await prisma.loop.findMany({ where: { active: true } });
  const wanted = new Set(loops.map((l) => LOOP_KEY(l.id)));

  for (const l of loops) {
    // schedule() is an upsert, so calling it again after a cron edit just replaces the old expression.
    await api.schedule(QUEUES.loopRun, l.schedule, { loopId: l.id }, { key: LOOP_KEY(l.id), tz: TZ });
  }
  for (const s of await api.getSchedules(QUEUES.loopRun)) {
    if (!wanted.has(s.key)) await api.unschedule(QUEUES.loopRun, s.key);
  }
}

export interface Runtime {
  start(opts?: { workers?: boolean }): Promise<void>;
  stop(): Promise<void>;
  enqueue: Enqueue;
  syncLoopSchedules(): Promise<void>;
  isStarted(): boolean;
}

export function createRuntime(deps: WorkerDeps, connectionString: string, pollSeconds = 2): Runtime {
  let boss: PgBoss | null = null;

  const need = (): PgBoss => {
    if (!boss) throw new Error("Queue is not started");
    return boss;
  };

  const enqueue: Enqueue = async (name: QueueName, data, opts) => {
    // singletonKey + a short window drops a duplicate send (double click, retried caller) instead of queueing twice.
    await need().send(name, data, opts?.singletonKey ? { singletonKey: opts.singletonKey, singletonSeconds: 30 } : {});
  };

  return {
    enqueue,
    isStarted: () => boss !== null,

    async syncLoopSchedules() {
      await syncSchedules(need());
    },

    async start(opts = {}) {
      if (boss) return;
      const b = new PgBoss(connectionString);
      b.on("error", (err) => console.error("[pg-boss]", err));
      await b.start();

      // Retries with backoff for every queue: a flaky network call is retried, but never forever.
      const retry = { retryLimit: 2, retryDelay: 30, retryBackoff: true };
      for (const name of Object.values(QUEUES)) await b.createQueue(name, retry);

      // A web-only process can start the queue with workers:false just to enqueue.
      if (opts.workers === false) {
        boss = b;
        return;
      }

      // Workers get an array (batchSize 1 by default). Throwing makes pg-boss retry the job.
      await b.work<{ loopId: number }>(QUEUES.loopRun, { pollingIntervalSeconds: pollSeconds }, async ([job]) => {
        await runLoop(job.data.loopId, deps);
      });
      await b.work<{ jobId: number }>(
        QUEUES.scoreJob,
        // 2 at a time: cheap model, but no reason to hammer the API rate limit
        { pollingIntervalSeconds: pollSeconds, localConcurrency: 2 },
        async ([job]) => {
          await scoreStep(job.data.jobId, deps);
        },
      );
      await b.work<{ jobId: number; force?: boolean }>(QUEUES.pushJob, { pollingIntervalSeconds: pollSeconds }, async ([job]) => {
        await pushStep(job.data.jobId, deps, { force: job.data.force });
      });
      await b.work<{ jobId: number; variantId?: number }>(QUEUES.tailor, { pollingIntervalSeconds: pollSeconds }, async ([job]) => {
        await deps.tailorAndRender(job.data.jobId, job.data.variantId);
      });
      await b.work<{ applicationId: number }>(QUEUES.prescan, { pollingIntervalSeconds: pollSeconds }, async ([job]) => {
        await deps.prescan(job.data.applicationId);
      });
      await b.work<{ applicationId: number }>(QUEUES.fill, { pollingIntervalSeconds: pollSeconds }, async ([job]) => {
        await deps.fill(job.data.applicationId);
      });

      boss = b;
      await syncSchedules(b);
    },

    async stop() {
      if (!boss) return;
      const b = boss;
      boss = null;
      await b.stop({ graceful: true, timeout: 10_000 });
    },
  };
}
