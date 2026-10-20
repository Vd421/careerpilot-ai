import { describe, it, expect, beforeEach, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../../src/db.js";
import { resetDb } from "../helpers/resetDb.js";
import { createApiRouter, type ApiDeps } from "../../src/api/index.js";
import type { RawJob } from "../../src/contracts.js";

const shotsDir = mkdtempSync(join(tmpdir(), "cp-shots-"));
writeFileSync(join(shotsDir, "ok.png"), "png");
const pdfDir = mkdtempSync(join(tmpdir(), "cp-pdfs-"));

function build(over: Partial<ApiDeps> = {}) {
  const calls = {
    enqueue: [] as [string, Record<string, unknown>][],
    sync: 0,
    raw: [] as [number, string][],
    approve: [] as unknown[][],
  };
  const deps: ApiDeps = {
    enqueue: async (name, data) => void calls.enqueue.push([name, data]),
    syncLoopSchedules: async () => void calls.sync++,
    fetchJobFromUrl: async () => null,
    tailorForJob: async (jobId) => {
      const v = await prisma.resumeVersion.create({
        data: { jobId, tailored: { headline: null, sections: [], skillsOrder: [], coverNote: null } },
      });
      return { resumeVersionId: v.id };
    },
    renderResumePdf: async (id) => {
      const p = join(pdfDir, `${id}.pdf`);
      writeFileSync(p, "%PDF-fake");
      await prisma.resumeVersion.update({ where: { id }, data: { pdfPath: p } });
      return { pdfPath: p };
    },
    submitRawAnswer: async (id, raw) => {
      calls.raw.push([id, raw]);
      return { polished: `Polished: ${raw}` };
    },
    approveAnswer: async (...args) => void calls.approve.push(args),
    isTelegramConnected: async () => false,
    screenshotsDir: shotsDir,
    ...over,
  };
  const app = express();
  app.use("/api", createApiRouter(deps));
  return { api: request(app), calls };
}

async function mkJob(over: Record<string, unknown> = {}) {
  return prisma.job.create({
    data: { company: "Acme", title: "Backend Engineer", description: "Node and Postgres", ...over },
  });
}
async function mkApp(jobId: number, status = "pending_approval", over: Record<string, unknown> = {}) {
  return prisma.application.create({ data: { jobId, status, idempotencyKey: `apply:${jobId}`, ...over } });
}
async function mkQuestion(applicationId: number, over: Record<string, unknown> = {}) {
  return prisma.question.create({
    data: { applicationId, text: "Notice period?", fieldName: "q1", fieldType: "text", required: true, ...over },
  });
}

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("status, overview, activity", () => {
  it("GET /status", async () => {
    const { api } = build();
    const res = await api.get("/api/status").expect(200);
    expect(res.body).toEqual({ telegramConnected: false, appliedToday: 0, dailyCap: 15, dryRun: true });
  });

  it("GET /overview counts and lists what is waiting on me", async () => {
    const { api } = build();
    const j = await mkJob();
    const a = await mkApp(j.id);
    await mkQuestion(a.id, { status: "asked" });
    const res = await api.get("/api/overview").expect(200);
    expect(res.body.stats).toMatchObject({ discovered: 1, applied: 0, awaitingMe: 2 });
    expect(res.body.funnel.map((f: { stage: string }) => f.stage)).toEqual([
      "discovered", "scored", "pushed", "approved", "applied", "replied",
    ]);
    expect(res.body.attention.map((x: { kind: string }) => x.kind).sort()).toEqual(["approval", "question"]);
  });

  it("GET /activity filters and pages; 400 on a bad limit", async () => {
    const { api } = build();
    const j = await mkJob();
    for (let i = 0; i < 3; i++) {
      await prisma.agentAction.create({ data: { type: "job.scored", jobId: j.id, detail: { i } } });
    }
    await prisma.agentAction.create({ data: { type: "job.pushed", detail: {} } });
    const all = await api.get("/api/activity?limit=2").expect(200);
    expect(all.body).toHaveLength(2);
    const typed = await api.get(`/api/activity?type=job.scored&jobId=${j.id}`).expect(200);
    expect(typed.body).toHaveLength(3);
    expect(typed.body[0].jobLabel).toBe("Acme · Backend Engineer");
    const older = await api.get(`/api/activity?before=${typed.body[0].id}&type=job.scored`).expect(200);
    expect(older.body).toHaveLength(2);
    await api.get("/api/activity?limit=0").expect(400);
  });
});

describe("jobs", () => {
  it("GET /jobs lists, filters and paginates; 400 on a bad stage", async () => {
    const { api } = build();
    const a = await mkJob({ title: "Alpha", stage: "scored", matchScore: 80 });
    const b = await mkJob({ title: "Beta", company: "Zed" });
    await mkApp(b.id, "applied");
    const res = await api.get("/api/jobs?pageSize=1").expect(200);
    expect(res.body).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(res.body.items).toHaveLength(1);

    const byStage = await api.get("/api/jobs?stage=scored").expect(200);
    expect(byStage.body.items.map((j: { id: number }) => j.id)).toEqual([a.id]);
    const byStatus = await api.get("/api/jobs?status=applied").expect(200);
    expect(byStatus.body.items[0]).toMatchObject({ id: b.id, status: "applied" });
    const byStageStatus = await api.get("/api/jobs?status=discovered").expect(200);
    expect(byStageStatus.body.total).toBe(0); // a is scored, b has an application
    const q = await api.get("/api/jobs?q=zed").expect(200);
    expect(q.body.items.map((j: { id: number }) => j.id)).toEqual([b.id]);
    await api.get("/api/jobs?stage=nope").expect(400);
  });

  it("GET /jobs/recent", async () => {
    const { api } = build();
    for (let i = 0; i < 12; i++) await mkJob({ title: `T${i}` });
    const res = await api.get("/api/jobs/recent").expect(200);
    expect(res.body).toHaveLength(10);
    expect(res.body[0].title).toBe("T11");
  });

  it("GET /jobs/:id returns detail; 404 and 400", async () => {
    const { api } = build();
    const j = await mkJob({
      matchedSkills: ["Node"],
      redFlags: [{ type: "seniority", detail: "3+ years" }],
      source: "remotive",
    });
    const res = await api.get(`/api/jobs/${j.id}`).expect(200);
    expect(res.body).toMatchObject({
      id: j.id,
      matchedSkills: ["Node"],
      status: "discovered",
      redFlags: [{ type: "seniority", detail: "3+ years" }],
      application: null,
      resumeVersions: [],
    });
    expect(res.body.attribution).toBeTruthy(); // remotive requires a link back
    await api.get("/api/jobs/9999").expect(404);
    await api.get("/api/jobs/abc").expect(400);
  });

  it("POST /jobs with a pasted description creates, logs and enqueues scoring", async () => {
    const { api, calls } = build();
    const body = { company: "Acme", title: "Dev", description: "We need a developer who knows Node and Postgres." };
    const res = await api.post("/api/jobs").send(body).expect(201);
    expect(res.body).toMatchObject({ company: "Acme", title: "Dev", source: "manual", status: "discovered" });
    expect(calls.enqueue).toEqual([["job.score", { jobId: res.body.id }]]);
    expect(await prisma.agentAction.count({ where: { type: "job.discovered" } })).toBe(1);

    // same paste again: no second job, no second scoring
    const again = await api.post("/api/jobs").send(body).expect(200);
    expect(again.body.id).toBe(res.body.id);
    expect(calls.enqueue).toHaveLength(1);
    expect(await prisma.job.count()).toBe(1);

    // different text, same title/company, no URL: a different job
    await api.post("/api/jobs").send({ ...body, description: body.description + " Also Kafka." }).expect(201);
    expect(await prisma.job.count()).toBe(2);
  });

  it("POST /jobs with a board URL uses fetchJobFromUrl", async () => {
    const raw: RawJob = {
      source: "greenhouse", externalId: "1", company: "Globex", title: "Engineer",
      url: "https://boards.greenhouse.io/globex/jobs/1", description: "Fetched JD text that is long enough.",
      location: "Remote", remote: true, salaryMin: null, salaryMax: null, salaryCurrency: null,
      postedAt: null, applyPlatform: "greenhouse",
    };
    const { api } = build({ fetchJobFromUrl: async () => raw });
    const res = await api.post("/api/jobs").send({ url: raw.url }).expect(201);
    expect(res.body).toMatchObject({ company: "Globex", source: "greenhouse", applyPlatform: "greenhouse", remote: true });
  });

  it("POST /jobs 400s without url/description, or with an unreadable URL and no description", async () => {
    const { api, calls } = build();
    await api.post("/api/jobs").send({}).expect(400);
    await api.post("/api/jobs").send({ url: "not a url" }).expect(400);
    await api.post("/api/jobs").send({ url: "https://example.com/job/1" }).expect(400);
    await api.post("/api/jobs").send({ description: "short" }).expect(400);
    expect(calls.enqueue).toHaveLength(0);
  });

  it("POST /jobs/:id/push creates the application and enqueues the card, but never approves", async () => {
    const { api, calls } = build();
    const j = await mkJob();
    const res = await api.post(`/api/jobs/${j.id}/push`).expect(200);
    const app = await prisma.application.findUniqueOrThrow({ where: { id: res.body.applicationId } });
    expect(app).toMatchObject({ status: "pending_approval", approvedAt: null, submitApprovedAt: null, idempotencyKey: `apply:${j.id}` });
    expect(calls.enqueue).toEqual([["job.push", { jobId: j.id, force: true }]]);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: j.id } })).stage).toBe("pushed");

    // pushing again reuses the same application
    const again = await api.post(`/api/jobs/${j.id}/push`).expect(200);
    expect(again.body.applicationId).toBe(res.body.applicationId);
    expect(await prisma.application.count()).toBe(1);
  });

  it("POST /jobs/:id/push: 404 for unknown job, 409 once approved, skipped goes back to pending", async () => {
    const { api } = build();
    await api.post("/api/jobs/999/push").expect(404);
    const j = await mkJob();
    await mkApp(j.id, "approved");
    await api.post(`/api/jobs/${j.id}/push`).expect(409);

    const j2 = await mkJob({ title: "Other" });
    const a2 = await mkApp(j2.id, "skipped");
    await api.post(`/api/jobs/${j2.id}/push`).expect(200);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: a2.id } })).status).toBe("pending_approval");
  });

  it("there is no API route to approve or submit", async () => {
    const { api } = build();
    const j = await mkJob();
    const a = await mkApp(j.id);
    for (const path of ["approve", "submit", "apply"]) {
      await api.post(`/api/applications/${a.id}/${path}`).expect(404);
      await api.post(`/api/jobs/${j.id}/${path}`).expect(404);
    }
    const fresh = await prisma.application.findUniqueOrThrow({ where: { id: a.id } });
    expect(fresh.approvedAt).toBeNull();
    expect(fresh.submitApprovedAt).toBeNull();
  });

  it("POST /jobs/:id/tailor tailors, renders the PDF and returns the version", async () => {
    const { api } = build();
    const j = await mkJob();
    const res = await api.post(`/api/jobs/${j.id}/tailor`).expect(200);
    expect(res.body).toMatchObject({ pdfUrl: `/api/resume-versions/${res.body.id}/pdf` });
    await api.post("/api/jobs/999/tailor").expect(404);
  });

  it("POST /jobs/:id/skip with and without an application; 404; 409", async () => {
    const { api } = build();
    const j = await mkJob();
    await api.post(`/api/jobs/${j.id}/skip`).expect(204);
    expect((await prisma.application.findUniqueOrThrow({ where: { jobId: j.id } })).status).toBe("skipped");
    await api.post(`/api/jobs/${j.id}/skip`).expect(204); // idempotent

    const j2 = await mkJob({ title: "B" });
    await mkApp(j2.id, "pending_approval");
    await api.post(`/api/jobs/${j2.id}/skip`).expect(204);
    const j3 = await mkJob({ title: "C" });
    await mkApp(j3.id, "applied");
    await api.post(`/api/jobs/${j3.id}/skip`).expect(409);
    await api.post("/api/jobs/999/skip").expect(404);
    expect(await prisma.agentAction.count({ where: { type: "application.skipped" } })).toBe(2);
  });
});

describe("applications", () => {
  it("GET /applications filters by status", async () => {
    const { api } = build();
    const a = await mkJob();
    const b = await mkJob({ title: "B" });
    await mkApp(a.id, "manual", { manualReason: "captcha" });
    await mkApp(b.id, "applied");
    const all = await api.get("/api/applications").expect(200);
    expect(all.body).toHaveLength(2);
    const manual = await api.get("/api/applications?status=manual").expect(200);
    expect(manual.body).toMatchObject([{ status: "manual", manualReason: "captcha", company: "Acme" }]);
    await api.get("/api/applications?status=bogus").expect(400);
  });

  it("GET /applications/:id returns questions and links", async () => {
    const { api } = build();
    const j = await mkJob({ url: "https://x.com/job" });
    const a = await mkApp(j.id, "needs_answers", { screenshotPath: "data/private/screenshots/s1.png" });
    await mkQuestion(a.id);
    const res = await api.get(`/api/applications/${a.id}`).expect(200);
    expect(res.body).toMatchObject({ applyUrl: "https://x.com/job", screenshotUrl: "/api/screenshots/s1.png" });
    expect(res.body.questions).toHaveLength(1);
    await api.get("/api/applications/999").expect(404);
  });

  it("POST /applications/:id/mark-applied works from manual only", async () => {
    const { api } = build();
    const j = await mkJob();
    const a = await mkApp(j.id, "manual");
    await api.post(`/api/applications/${a.id}/mark-applied`).expect(204);
    const done = await prisma.application.findUniqueOrThrow({ where: { id: a.id } });
    expect(done).toMatchObject({ status: "applied", method: "manual" });
    expect(done.appliedAt).toBeInstanceOf(Date);
    expect(await prisma.agentAction.count({ where: { type: "application.marked_applied" } })).toBe(1);

    const j2 = await mkJob({ title: "B" });
    const a2 = await mkApp(j2.id, "pending_approval");
    await api.post(`/api/applications/${a2.id}/mark-applied`).expect(409);
    await api.post("/api/applications/999/mark-applied").expect(404);
  });
});

describe("questions and answers", () => {
  it("GET /questions filters by status", async () => {
    const { api } = build();
    const j = await mkJob();
    const a = await mkApp(j.id);
    await mkQuestion(a.id, { status: "asked" });
    await mkQuestion(a.id, { status: "answered", text: "Why us?" });
    expect((await api.get("/api/questions").expect(200)).body).toHaveLength(2);
    const asked = await api.get("/api/questions?status=asked").expect(200);
    expect(asked.body).toMatchObject([{ text: "Notice period?", company: "Acme", jobTitle: "Backend Engineer" }]);
    await api.get("/api/questions?status=zzz").expect(400);
  });

  it("POST /questions/:id/answer passes the raw answer on", async () => {
    const { api, calls } = build();
    const j = await mkJob();
    const q = await mkQuestion((await mkApp(j.id)).id);
    const res = await api.post(`/api/questions/${q.id}/answer`).send({ rawAnswer: "60 days" }).expect(200);
    expect(res.body).toEqual({ polished: "Polished: 60 days" });
    expect(calls.raw).toEqual([[q.id, "60 days"]]);
    await api.post(`/api/questions/${q.id}/answer`).send({ rawAnswer: "  " }).expect(400);
    await api.post("/api/questions/999/answer").send({ rawAnswer: "x" }).expect(404);
  });

  it("POST /questions/:id/approve maps the choice", async () => {
    const { api, calls } = build();
    const j = await mkJob();
    const q = await mkQuestion((await mkApp(j.id)).id);
    await api.post(`/api/questions/${q.id}/approve`).send({ choice: "polished", reusable: true }).expect(204);
    await api.post(`/api/questions/${q.id}/approve`).send({ choice: "edited", edited: "My text", reusable: false }).expect(204);
    expect(calls.approve).toEqual([
      [q.id, "polished", true],
      [q.id, { edited: "My text" }, false],
    ]);
    await api.post(`/api/questions/${q.id}/approve`).send({ choice: "edited", reusable: false }).expect(400);
    await api.post(`/api/questions/${q.id}/approve`).send({ choice: "nope", reusable: false }).expect(400);
    await api.post("/api/questions/999/approve").send({ choice: "original", reusable: false }).expect(404);
  });

  it("answer bank: list, patch, delete", async () => {
    const { api } = build();
    const a = await prisma.answer.create({ data: { key: "notice", questionText: "notice period", rawAnswer: "60 days" } });
    expect((await api.get("/api/answers").expect(200)).body).toMatchObject([{ id: a.id, approved: false }]);
    const patched = await api.patch(`/api/answers/${a.id}`).send({ approved: true, reusable: true, tags: ["fact"] }).expect(200);
    expect(patched.body).toMatchObject({ approved: true, reusable: true, tags: ["fact"], rawAnswer: "60 days" });
    await api.patch(`/api/answers/${a.id}`).send({ approved: "yes" }).expect(400);
    await api.patch("/api/answers/999").send({ approved: true }).expect(404);
    await api.delete(`/api/answers/${a.id}`).expect(204);
    await api.delete(`/api/answers/${a.id}`).expect(404);
  });
});

describe("loops", () => {
  const input = {
    name: "India backend",
    keywords: ["node", "typescript"],
    locations: ["Remote", "India"],
    sources: ["remotive", "greenhouse"],
    filters: { remoteOnly: true, excludeKeywords: ["senior"] },
    resumeVariantIds: [] as number[],
    schedule: "0 */6 * * *",
  };

  it("POST /loops creates (and syncs schedules); GET lists", async () => {
    const { api, calls } = build();
    const res = await api.post("/api/loops").send(input).expect(201);
    expect(res.body).toMatchObject({ name: "India backend", active: true, filters: { remoteOnly: true } });
    expect(res.body.nextRunAt).toBeTruthy();
    expect(res.body.stats).toEqual({ found: 0, approved: 0, applied: 0, replied: 0, responseRate: 0 });
    expect(calls.sync).toBe(1);
    expect((await api.get("/api/loops").expect(200)).body).toHaveLength(1);
  });

  it("POST /loops validates: bad cron, empty keywords, unknown source, dup name, unknown variant", async () => {
    const { api } = build();
    await api.post("/api/loops").send({ ...input, schedule: "every day" }).expect(400);
    await api.post("/api/loops").send({ ...input, keywords: [] }).expect(400);
    await api.post("/api/loops").send({ ...input, sources: ["linkedin"] }).expect(400);
    await api.post("/api/loops").send({ ...input, resumeVariantIds: [99] }).expect(400);
    await api.post("/api/loops").send(input).expect(201);
    await api.post("/api/loops").send(input).expect(409);
  });

  it("GET /loops/:id computes loop and per-variant stats", async () => {
    const { api } = build();
    const va = await prisma.resumeVariant.create({ data: { name: "A", filePath: "x" } });
    const vb = await prisma.resumeVariant.create({ data: { name: "B", filePath: "x" } });
    const loop = await prisma.loop.create({
      data: { name: "L", keywords: ["a"], locations: [], sources: ["remotive"], resumeVariantIds: [va.id, vb.id] },
    });
    const mk = async (title: string, status: string, variant: number, approved: boolean) => {
      const j = await mkJob({ title, loopId: loop.id });
      await mkApp(j.id, status, {
        loopId: loop.id,
        resumeVariantId: variant,
        approvedAt: approved ? new Date() : null,
      });
    };
    await mk("1", "applied", va.id, true);
    await mk("2", "replied", va.id, true);
    await mk("3", "interview", vb.id, true);
    await mk("4", "pending_approval", vb.id, false);
    await mk("5", "rejected", vb.id, true);

    const res = await api.get(`/api/loops/${loop.id}`).expect(200);
    expect(res.body.stats).toEqual({ found: 5, approved: 4, applied: 4, replied: 2, responseRate: 0.5 });
    const byName = Object.fromEntries(res.body.variants.map((v: { variantName: string }) => [v.variantName, v]));
    expect(byName.A).toMatchObject({ found: 2, applied: 2, replied: 1, responseRate: 0.5 });
    expect(byName.B).toMatchObject({ found: 3, approved: 2, applied: 2, replied: 1 });
    await api.get("/api/loops/999").expect(404);
  });

  it("PATCH /loops/:id updates and syncs; 404; 400", async () => {
    const { api, calls } = build();
    const created = (await api.post("/api/loops").send(input).expect(201)).body;
    const res = await api.patch(`/api/loops/${created.id}`).send({ keywords: ["go"], schedule: "0 9 * * *" }).expect(200);
    expect(res.body).toMatchObject({ keywords: ["go"], schedule: "0 9 * * *", name: "India backend" });
    expect(calls.sync).toBe(2);
    await api.patch(`/api/loops/${created.id}`).send({ schedule: "nope" }).expect(400);
    await api.patch("/api/loops/999").send({ keywords: ["x"] }).expect(404);
  });

  it("pause / resume / run", async () => {
    const { api, calls } = build();
    const { id } = (await api.post("/api/loops").send(input).expect(201)).body;
    const paused = await api.post(`/api/loops/${id}/pause`).expect(200);
    expect(paused.body).toMatchObject({ active: false, nextRunAt: null });
    const resumed = await api.post(`/api/loops/${id}/resume`).expect(200);
    expect(resumed.body.active).toBe(true);
    expect(calls.sync).toBe(3);
    expect((await prisma.agentAction.findMany({ where: { loopId: id } })).map((a) => a.type).sort()).toEqual(["loop.paused", "loop.resumed"]);
    await api.post(`/api/loops/${id}/run`).expect(200);
    expect(calls.enqueue).toEqual([["loop.run", { loopId: id }]]);
    await api.post("/api/loops/999/pause").expect(404);
    await api.post("/api/loops/999/resume").expect(404);
    await api.post("/api/loops/999/run").expect(404);
  });
});

describe("variants, sources, settings", () => {
  it("GET /resume-variants", async () => {
    const { api } = build();
    await prisma.resumeVariant.create({ data: { name: "A", filePath: "data/private/resume.json" } });
    expect((await api.get("/api/resume-variants").expect(200)).body).toMatchObject([{ name: "A" }]);
  });

  it("GET /sources reports enabled and configured", async () => {
    const { api } = build();
    await prisma.settings.create({ data: { id: 1, sources: { remotive: false } } });
    const res = await api.get("/api/sources").expect(200);
    const by = Object.fromEntries(res.body.map((s: { id: string }) => [s.id, s]));
    expect(by.remotive.enabled).toBe(false);
    expect(by.greenhouse).toMatchObject({ enabled: true, configured: true });
    expect(res.body.length).toBeGreaterThan(5);
  });

  it("GET /settings creates defaults", async () => {
    const { api } = build();
    const res = await api.get("/api/settings").expect(200);
    expect(res.body).toMatchObject({ dailyCap: 15, dryRun: true, noticeDays: 60, telegramLinked: false });
  });

  it("PUT /settings clamps dailyCap to 15 and logs the diff", async () => {
    const { api } = build();
    const res = await api.put("/api/settings").send({ dailyCap: 100, matchThreshold: 70 }).expect(200);
    expect(res.body).toMatchObject({ dailyCap: 15, matchThreshold: 70 });
    const action = await prisma.agentAction.findFirstOrThrow({ where: { type: "settings.updated" } });
    expect(action.detail).toMatchObject({ changes: { matchThreshold: { from: 65, to: 70 } } });
  });

  it("PUT /settings logs turning dryRun off loudly; no-op changes log nothing", async () => {
    const { api } = build();
    await api.put("/api/settings").send({ dryRun: true }).expect(200);
    expect(await prisma.agentAction.count()).toBe(0);
    await api.put("/api/settings").send({ dryRun: false }).expect(200);
    const action = await prisma.agentAction.findFirstOrThrow({ where: { type: "settings.updated" } });
    expect(action.detail).toMatchObject({ changes: { dryRun: { from: true, to: false } } });
    expect(JSON.stringify(action.detail)).toContain("warning");
  });

  it("PUT /settings merges sources and ignores telegramLinked; 400 on bad values", async () => {
    const { api } = build();
    await api.put("/api/settings").send({ sources: { remotive: false } }).expect(200);
    const res = await api.put("/api/settings").send({ sources: { remoteok: false }, telegramLinked: true }).expect(200);
    expect(res.body.sources).toEqual({ remotive: false, remoteok: false });
    expect(res.body.telegramLinked).toBe(false);
    await api.put("/api/settings").send({ matchThreshold: 500 }).expect(400);
    await api.put("/api/settings").send({ sources: { linkedin: true } }).expect(400);
  });
});

describe("files", () => {
  it("GET /resume-versions/:id/pdf serves, renders on demand, and 404s", async () => {
    const { api } = build();
    const j = await mkJob();
    const v = await prisma.resumeVersion.create({
      data: { jobId: j.id, tailored: { headline: null, sections: [], skillsOrder: [], coverNote: null } },
    });
    const res = await api.get(`/api/resume-versions/${v.id}/pdf`).expect(200); // rendered on demand
    expect(res.headers["content-type"]).toContain("application/pdf");
    await api.get(`/api/resume-versions/${v.id}/pdf`).expect(200); // now served from disk
    await api.get("/api/resume-versions/999/pdf").expect(404);
  });

  it("GET /screenshots/:file serves existing files only, no path traversal", async () => {
    const { api } = build();
    await api.get("/api/screenshots/ok.png").expect(200);
    await api.get("/api/screenshots/missing.png").expect(404);
    await api.get("/api/screenshots/..%2F..%2Fpackage.json").expect(400);
    await api.get("/api/screenshots/..%5Cpackage.json").expect(400);
    await api.get("/api/screenshots/.hidden").expect(400);
  });
});

describe("errors", () => {
  it("unknown route is a 404 ApiError; bad JSON is a 400", async () => {
    const { api } = build();
    expect((await api.get("/api/nope").expect(404)).body).toMatchObject({ error: "Not found" });
    await api.post("/api/jobs").set("Content-Type", "application/json").send("{bad").expect(400);
  });
});
