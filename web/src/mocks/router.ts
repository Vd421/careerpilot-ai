// Tiny in-memory "server" for VITE_MOCK=1. Same URLs and shapes as contracts.ts,
// with real mutations so toggles, answers and pastes behave like the real thing.
import type {
  ActivityItem,
  AnswerItem,
  ApiError,
  ApplicationDetail,
  ApplicationStatus,
  ApproveAnswerRequest,
  CreateJobRequest,
  JobDetail,
  JobListItem,
  LoopDetail,
  LoopInput,
  OverviewResponse,
  QuestionItem,
  ResumeVersionItem,
  SettingsDto,
  AttentionItem,
} from "@contracts";
import { HARD_DAILY_CAP } from "@contracts";
import { buildDb, type MockDb } from "./data";

let db: MockDb = buildDb();

export function resetMock() {
  db = buildDb();
}

const LATENCY = import.meta.env.MODE === "test" ? 0 : 140;
const wait = (ms = LATENCY) => new Promise((r) => setTimeout(r, ms + (ms ? Math.random() * 120 : 0)));

class MockError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, body: ApiError) {
    super(body.error);
    this.status = status;
    this.details = body.details;
  }
}

type Q = Record<string, string | number | undefined | null>;
type Handler = (m: RegExpMatchArray, q: Q, body: any) => unknown; // eslint-disable-line @typescript-eslint/no-explicit-any
const routes: { method: string; re: RegExp; fn: Handler }[] = [];
const route = (method: string, pattern: string, fn: Handler) =>
  routes.push({ method, re: new RegExp(`^${pattern.replace(/:id/g, "(\\d+)")}$`), fn });

export async function mockRequest<T>(method: string, path: string, query: Q, body: unknown): Promise<T> {
  await wait();
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = path.match(r.re);
    if (m) return clone(r.fn(m, query, body)) as T;
  }
  throw new MockError(404, { error: `No mock for ${method} ${path}` });
}

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
const num = (v: unknown, d: number) => (v == null || v === "" ? d : Number(v));
const toListItem = (j: JobDetail): JobListItem => {
  const {
    description: _d, summary: _s, matchedSkills: _m, missingSkills: _x, filterReasons: _f, applyPlatform: _a, attribution: _t, resumeVersions: _r, application: _p,
    ...item
  } = j;
  void [_d, _s, _m, _x, _f, _a, _t, _r, _p];
  return item;
};
const findJob = (id: number) => {
  const j = db.jobs.find((x) => x.id === id);
  if (!j) throw new MockError(404, { error: "Job not found" });
  return j;
};
const log = (type: ActivityItem["type"], j: JobDetail | null, detail: Record<string, unknown> = {}) => {
  db.activity.unshift({
    id: (db.activity[0]?.id ?? 0) + 1, type,
    jobId: j?.id ?? null, applicationId: j?.applicationId ?? null, loopId: j?.loopId ?? null,
    jobLabel: j ? `${j.company} · ${j.title}` : null, detail, createdAt: new Date().toISOString(),
  });
};

const APPLIED_SET: ApplicationStatus[] = ["applied", "replied", "interview", "rejected", "offer"];
const REPLY_SET: ApplicationStatus[] = ["replied", "interview", "offer"];

// ---- status / overview ----------------------------------------------------
route("GET", "/status", () => ({
  telegramConnected: db.telegramConnected && db.settings.telegramLinked,
  appliedToday: 4,
  dailyCap: db.settings.dailyCap,
  dryRun: db.settings.dryRun,
}));

route("GET", "/overview", (): OverviewResponse => {
  const apps = db.applications;
  const attention: AttentionItem[] = [
    ...apps.filter((a) => a.status === "pending_approval").map((a) => ({ kind: "approval" as const, id: a.id, title: `${a.company} · ${a.title}`, subtitle: "Card waiting on Telegram", createdAt: a.createdAt })),
    ...db.questions.filter((q) => q.status !== "answered").map((q) => ({ kind: "question" as const, id: q.id, title: q.text, subtitle: `${q.company} · ${q.jobTitle}`, createdAt: q.createdAt })),
    ...apps.filter((a) => a.status === "approved").map((a) => ({ kind: "submit" as const, id: a.id, title: `${a.company} · ${a.title}`, subtitle: "Filled as a dry run, confirm on Telegram to submit", createdAt: a.createdAt })),
    ...apps.filter((a) => a.status === "manual").map((a) => ({ kind: "manual" as const, id: a.id, title: `${a.company} · ${a.title}`, subtitle: "Apply by hand, link and PDF ready", createdAt: a.createdAt })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const scored = db.jobs.filter((j) => j.matchScore != null).length;
  const pushed = apps.length;
  const approved = apps.filter((a) => !["pending_approval", "skipped"].includes(a.status)).length;
  const applied = apps.filter((a) => APPLIED_SET.includes(a.status)).length;
  const replied = apps.filter((a) => REPLY_SET.includes(a.status) || a.status === "rejected").length;
  return {
    stats: {
      discovered: db.jobs.filter((j) => j.status !== "filtered_out").length,
      applied,
      awaitingMe: apps.filter((a) => a.status === "pending_approval").length + db.questions.filter((q) => q.status !== "answered").length,
      replies: apps.filter((a) => REPLY_SET.includes(a.status)).length,
    },
    funnel: [
      { stage: "Discovered", count: db.jobs.length },
      { stage: "Scored", count: scored },
      { stage: "Pushed", count: pushed },
      { stage: "Approved", count: approved },
      { stage: "Applied", count: applied },
      { stage: "Replied", count: replied },
    ],
    attention,
    recentActivity: db.activity.slice(0, 8),
  };
});

// ---- jobs -------------------------------------------------------------------
route("GET", "/jobs/recent", () => [...db.jobs].filter((j) => j.status !== "filtered_out").sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10).map(toListItem));

route("GET", "/jobs", (_m, q) => {
  const page = num(q.page, 1);
  const pageSize = num(q.pageSize, 50);
  const needle = String(q.q ?? "").toLowerCase();
  const items = db.jobs
    .filter((j) => (q.status || q.stage ? true : j.status !== "filtered_out"))
    .filter((j) => !q.status || j.status === q.status)
    .filter((j) => !q.stage || j.status === q.stage)
    .filter((j) => !q.source || j.source === q.source)
    .filter((j) => !q.loopId || j.loopId === Number(q.loopId))
    .filter((j) => !needle || `${j.company} ${j.title}`.toLowerCase().includes(needle))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { items: items.slice((page - 1) * pageSize, page * pageSize).map(toListItem), total: items.length, page, pageSize };
});

route("GET", "/jobs/:id", (m) => findJob(Number(m[1])));

route("POST", "/jobs", (_m, _q, body: CreateJobRequest) => {
  if (!body?.url?.trim() && !body?.description?.trim()) throw new MockError(400, { error: "Paste a job description or a URL" });
  const id = Math.max(...db.jobs.map((j) => j.id)) + 1;
  const job: JobDetail = {
    id, company: body.company?.trim() || "Unknown company", title: body.title?.trim() || "Pasted role", source: "manual",
    url: body.url?.trim() || null, location: null, remote: null, matchScore: null, salaryMin: null, salaryMax: null, salaryCurrency: null,
    redFlags: [], tags: [], status: "discovered", applicationId: null, loopId: null, createdAt: new Date().toISOString(),
    description: body.description?.trim() || `Fetched from ${body.url}`, summary: null, matchedSkills: [], missingSkills: [], filterReasons: [],
    applyPlatform: "other", attribution: null, resumeVersions: [], application: null,
  };
  db.jobs.unshift(job);
  log("job.discovered", job, { source: "manual" });
  // Scoring runs in the background on the real server; imitate that so the row updates on refetch.
  if (LATENCY) {
    setTimeout(() => {
      job.matchScore = 76;
      job.status = "scored";
      job.summary = "Scored from the pasted description. Core stack overlaps with your resume.";
      job.matchedSkills = ["TypeScript", "React", "Node.js"];
      job.missingSkills = ["AWS"];
      log("job.scored", job, { score: 76 });
    }, 2800);
  }
  return job;
});

route("POST", "/jobs/:id/push", (m) => {
  const job = findJob(Number(m[1]));
  if (job.applicationId) return { applicationId: job.applicationId };
  const appId = Math.max(0, ...db.applications.map((a) => a.id)) + 1;
  const app: ApplicationDetail = {
    id: appId, jobId: job.id, company: job.company, title: job.title, status: "pending_approval", method: null,
    resumeVersionId: null, variantName: null, appliedAt: null, screenshotUrl: null, manualReason: null, applyUrl: job.url,
    createdAt: new Date().toISOString(), pdfUrl: null, questions: [],
  };
  db.applications.unshift(app);
  job.applicationId = appId;
  job.application = app;
  job.status = "pending_approval";
  log("job.pushed", job);
  log("telegram.card_sent", job);
  return { applicationId: appId };
});

route("POST", "/jobs/:id/tailor", (m): ResumeVersionItem => {
  const job = findJob(Number(m[1]));
  const id = Math.max(0, ...db.resumeVersions.keys()) + 1;
  const base = db.resumeVersions.get(1)!;
  const rv: ResumeVersionItem = { ...clone(base), id, variantName: "A", pdfUrl: `/api/resume-versions/${id}/pdf`, createdAt: new Date().toISOString() };
  db.resumeVersions.set(id, rv);
  job.resumeVersions.unshift(rv);
  if (job.application) {
    job.application.resumeVersionId = id;
    job.application.variantName = "A";
    const app = db.applications.find((a) => a.id === job.application!.id);
    if (app) {
      app.resumeVersionId = id;
      app.variantName = "A";
      app.pdfUrl = rv.pdfUrl;
    }
  }
  log("resume.tailored", job, { variant: "A" });
  log("resume.pdf_rendered", job);
  return rv;
});

route("POST", "/jobs/:id/skip", (m) => {
  const job = findJob(Number(m[1]));
  job.status = "skipped";
  if (job.application) job.application.status = "skipped";
  const app = db.applications.find((a) => a.id === job.applicationId);
  if (app) app.status = "skipped";
  log("application.skipped", job);
  return undefined;
});

// ---- applications -----------------------------------------------------------
route("GET", "/applications", (_m, q) =>
  db.applications
    .filter((a) => !q.status || a.status === q.status)
    .filter((a) => !q.loopId || db.jobs.find((j) => j.id === a.jobId)?.loopId === Number(q.loopId))
    .map(({ pdfUrl: _p, questions: _q, ...item }) => (void [_p, _q], item)),
);
route("GET", "/applications/:id", (m) => {
  const a = db.applications.find((x) => x.id === Number(m[1]));
  if (!a) throw new MockError(404, { error: "Application not found" });
  return { ...a, questions: db.questions.filter((q) => q.applicationId === a.id) };
});
route("POST", "/applications/:id/mark-applied", (m) => {
  const a = db.applications.find((x) => x.id === Number(m[1]));
  if (!a) throw new MockError(404, { error: "Application not found" });
  a.status = "applied";
  a.appliedAt = new Date().toISOString();
  const job = findJob(a.jobId);
  job.status = "applied";
  job.application = a;
  log("application.marked_applied", job);
  return undefined;
});

// ---- questions & answers -------------------------------------------------------
route("GET", "/questions", (_m, q) => db.questions.filter((x) => !q.status || x.status === q.status).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));

// A stand-in for the polish step: tidy case and punctuation only, never adds facts.
function polish(raw: string): string {
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t) return t;
  const s = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(s) ? s : `${s}.`;
}
const findQ = (id: number): QuestionItem => {
  const q = db.questions.find((x) => x.id === id);
  if (!q) throw new MockError(404, { error: "Question not found" });
  return q;
};
route("POST", "/questions/:id/answer", (m, _q, body: { rawAnswer: string }) => {
  const q = findQ(Number(m[1]));
  if (!body?.rawAnswer?.trim()) throw new MockError(400, { error: "Answer is empty" });
  const polished = polish(body.rawAnswer);
  const aid = Math.max(0, ...db.answers.map((a) => a.id)) + 1;
  q.answer = { id: aid, key: null, questionText: q.text, rawAnswer: body.rawAnswer.trim(), polishedAnswer: polished, approved: false, reusable: false, tags: [], updatedAt: new Date().toISOString() };
  q.status = "asked";
  q.askedVia = "dashboard";
  log("answer.polished", null, { questionId: q.id });
  return { polished };
});
route("POST", "/questions/:id/approve", (m, _q, body: ApproveAnswerRequest) => {
  const q = findQ(Number(m[1]));
  if (!q.answer) throw new MockError(409, { error: "Answer the question first" });
  if (body.choice === "edited" && !body.edited?.trim()) throw new MockError(400, { error: "Edited answer is empty" });
  q.answer.polishedAnswer = body.choice === "edited" ? body.edited!.trim() : body.choice === "original" ? q.answer.rawAnswer : q.answer.polishedAnswer;
  q.answer.approved = true;
  q.answer.reusable = body.reusable;
  q.answer.updatedAt = new Date().toISOString();
  q.status = "answered";
  db.answers.unshift(q.answer);
  log("answer.approved", null, { questionId: q.id, reusable: body.reusable });
  return undefined;
});

route("GET", "/answers", () => [...db.answers].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
route("PATCH", "/answers/:id", (m, _q, body: Partial<AnswerItem>) => {
  const a = db.answers.find((x) => x.id === Number(m[1]));
  if (!a) throw new MockError(404, { error: "Answer not found" });
  Object.assign(a, body, { id: a.id, updatedAt: new Date().toISOString() });
  return a;
});
route("DELETE", "/answers/:id", (m) => {
  db.answers = db.answers.filter((x) => x.id !== Number(m[1]));
  return undefined;
});

// ---- activity ----------------------------------------------------------------------
route("GET", "/activity", (_m, q) => {
  const limit = num(q.limit, 100);
  return db.activity
    .filter((a) => !q.type || a.type === q.type)
    .filter((a) => !q.jobId || a.jobId === Number(q.jobId))
    .filter((a) => !q.loopId || a.loopId === Number(q.loopId))
    .filter((a) => !q.before || a.id < Number(q.before))
    .slice(0, limit);
});

// ---- loops ----------------------------------------------------------------------------
const findLoop = (id: number): LoopDetail => {
  const l = db.loops.find((x) => x.id === id);
  if (!l) throw new MockError(404, { error: "Loop not found" });
  return l;
};
route("GET", "/loops", () => db.loops);
route("GET", "/loops/:id", (m) => findLoop(Number(m[1])));
route("POST", "/loops", (_m, _q, body: LoopInput) => {
  if (!body?.name?.trim()) throw new MockError(400, { error: "Name is required" });
  const loop: LoopDetail = {
    ...body, id: Math.max(...db.loops.map((l) => l.id)) + 1, active: true, lastRunAt: null,
    nextRunAt: new Date(Date.now() + 3_600_000).toISOString(),
    stats: { found: 0, approved: 0, applied: 0, replied: 0, responseRate: 0 },
    variants: body.resumeVariantIds.map((vid) => ({ variantId: vid, variantName: db.variants.find((v) => v.id === vid)?.name ?? "?", found: 0, approved: 0, applied: 0, replied: 0, responseRate: 0 })),
  };
  db.loops.push(loop);
  log("settings.updated", null, { loop: loop.name });
  return loop;
});
route("PATCH", "/loops/:id", (m, _q, body: Partial<LoopInput>) => Object.assign(findLoop(Number(m[1])), body));
route("POST", "/loops/:id/pause", (m) => {
  const l = findLoop(Number(m[1]));
  l.active = false;
  l.nextRunAt = null;
  log("loop.paused", null, { loop: l.name });
  return l;
});
route("POST", "/loops/:id/resume", (m) => {
  const l = findLoop(Number(m[1]));
  l.active = true;
  l.nextRunAt = new Date(Date.now() + 4 * 3_600_000).toISOString();
  log("loop.resumed", null, { loop: l.name });
  return l;
});
route("POST", "/loops/:id/run", (m) => {
  const l = findLoop(Number(m[1]));
  l.lastRunAt = new Date().toISOString();
  log("loop.run_started", null, { loop: l.name });
  return l;
});

route("GET", "/resume-variants", () => db.variants);
route("GET", "/sources", () => db.sources.map((s) => ({ ...s, enabled: db.settings.sources[s.id] ?? false })));
route("GET", "/settings", (): SettingsDto => db.settings);
route("PUT", "/settings", (_m, _q, body: Partial<SettingsDto>) => {
  if (body.dailyCap != null && (body.dailyCap < 1 || body.dailyCap > HARD_DAILY_CAP)) {
    throw new MockError(400, { error: `Daily cap must be between 1 and ${HARD_DAILY_CAP}` });
  }
  db.settings = { ...db.settings, ...body, sources: { ...db.settings.sources, ...(body.sources ?? {}) } };
  log("settings.updated", null, Object.fromEntries(Object.keys(body).map((k) => [k, true])));
  return db.settings;
});
