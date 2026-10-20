import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { CALLBACK } from "../../src/contracts.js";
import { prisma } from "../../src/db.js";
import { fillApplication } from "../../src/apply/fill.js";
import { startApplication } from "../../src/apply/start.js";
import { TailorCapError } from "../../src/tailor/index.js";
import { resetDb } from "../helpers/resetDb.js";
import { actionTypes, field, makeApplyWorld, standardFields, statusOf } from "./support.js";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const bankAnswer = (patterns: string[], answer: string) =>
  prisma.answer.create({
    data: { key: patterns[0].replaceAll(" ", "_"), questionText: patterns[0], patterns, rawAnswer: answer, approved: true, reusable: true },
  });

const phoneField = field({ name: "phone", label: "Phone", required: true });
const noticeField = field({ name: "q_notice", label: "Notice period", required: true });
const whyField = field({ name: "q_why", label: "Why do you want to work here?", type: "textarea", required: true });

describe("startApplication", () => {
  it("refuses to do anything without my [Apply] tap", async () => {
    const w = await makeApplyWorld({ approved: false });
    await startApplication(w.application.id, w.deps);
    expect(w.filler.prescanCalls).toHaveLength(0);
    expect(await statusOf(w.application.id)).toBe("pending_approval");
  });

  it("unsupported platform -> manual with link, PDF and the answers I already have", async () => {
    const w = await makeApplyWorld({ platform: "other" });
    await startApplication(w.application.id, w.deps);
    const app = await prisma.application.findUniqueOrThrow({ where: { id: w.application.id } });
    expect(app).toMatchObject({ status: "manual", method: "manual", manualReason: "unsupported_platform" });
    expect(w.filler.prescanCalls).toHaveLength(0);
    expect(w.sent.some((s) => s.kind === "message" && s.text.includes("boards.greenhouse.io/acme/jobs/1"))).toBe(true);
    expect(w.sent.some((s) => s.kind === "document")).toBe(true);
    expect(w.sent.map((s) => s.text).join("\n")).toContain("Email: asha@example.com");
    expect(await actionTypes("application.manual")).toHaveLength(1);
  });

  it("captcha blocker -> manual (reason captcha), questions kept for the copy-paste list", async () => {
    const w = await makeApplyWorld();
    await prisma.answer.create({ data: { key: "notice", questionText: "notice period", patterns: ["notice period"], rawAnswer: "60 days", approved: true, reusable: true } });
    w.filler.scan = { ok: false, fields: [...standardFields, noticeField], blocker: "captcha" };
    await startApplication(w.application.id, w.deps);
    expect(await statusOf(w.application.id)).toBe("manual");
    expect((await prisma.application.findUniqueOrThrow({ where: { id: w.application.id } })).manualReason).toBe("captcha");
    expect(w.sent.map((s) => s.text).join("\n")).toContain("Notice period *: 60 days");
    expect(w.enqueued).toHaveLength(0);
  });

  it("unknown_form blocker -> manual", async () => {
    const w = await makeApplyWorld();
    w.filler.scan = { ok: false, fields: [], blocker: "unknown_form" };
    await startApplication(w.application.id, w.deps);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: w.application.id } })).manualReason).toBe("unknown_form");
  });

  it("standard fields + bank answers cover everything -> approved and fill queued", async () => {
    const w = await makeApplyWorld();
    await bankAnswer(["notice period"], "60 days");
    w.filler.scan = { ok: true, fields: [...standardFields, noticeField], blocker: null };
    await startApplication(w.application.id, w.deps);
    expect(await statusOf(w.application.id)).toBe("approved");
    expect(w.enqueued).toEqual([{ name: "apply.fill", data: { applicationId: w.application.id } }]);
    const q = await prisma.question.findFirstOrThrow({ where: { applicationId: w.application.id } });
    expect(q).toMatchObject({ status: "answered", askedVia: "bank", fieldName: "q_notice" });
    expect(await actionTypes("question.matched_bank")).toHaveLength(1);
    expect(await actionTypes("form.prescanned")).toHaveLength(1);
    expect(w.sent).toHaveLength(0); // nothing to ask me
  });

  it("an unknown required question is asked on Telegram and the application waits in needs_answers", async () => {
    const w = await makeApplyWorld();
    await bankAnswer(["notice period"], "60 days");
    w.filler.scan = { ok: true, fields: [...standardFields, noticeField, whyField, field({ name: "q_opt", label: "Anything else?", type: "textarea" })], blocker: null };
    await startApplication(w.application.id, w.deps);
    expect(await statusOf(w.application.id)).toBe("needs_answers");
    expect(w.enqueued).toHaveLength(0);
    const questions = await prisma.question.findMany({ where: { applicationId: w.application.id }, orderBy: { id: "asc" } });
    expect(questions.map((q) => [q.fieldName, q.status])).toEqual([["q_notice", "answered"], ["q_why", "asked"]]); // optional unknown: not created
    expect(w.sent.some((s) => s.text.includes("Why do you want to work here?"))).toBe(true);
    expect(await actionTypes("question.asked")).toHaveLength(1);
  });

  it("a standard field the resume can't fill (no phone on file) is asked like any other question", async () => {
    const w = await makeApplyWorld();
    w.filler.scan = { ok: true, fields: [...standardFields, phoneField], blocker: null };
    await startApplication(w.application.id, w.deps);
    expect(await statusOf(w.application.id)).toBe("needs_answers");
    expect((await prisma.question.findFirstOrThrow({ where: { applicationId: w.application.id } })).fieldName).toBe("phone");
  });

  it("running it twice (queue retry) doesn't duplicate questions or re-ask", async () => {
    const w = await makeApplyWorld();
    w.filler.scan = { ok: true, fields: [...standardFields, whyField], blocker: null };
    await startApplication(w.application.id, w.deps);
    await startApplication(w.application.id, w.deps);
    expect(await prisma.question.count()).toBe(1);
    expect(w.sent.filter((s) => s.text.includes("Why do you want to work here?"))).toHaveLength(1);
  });

  it("an unapproved draft answer does not count as an answer", async () => {
    const w = await makeApplyWorld();
    w.filler.scan = { ok: true, fields: [...standardFields, whyField], blocker: null };
    await startApplication(w.application.id, w.deps);
    const q = await prisma.question.findFirstOrThrow();
    const draft = await prisma.answer.create({ data: { questionText: "why", rawAnswer: "draft", approved: false } });
    await prisma.question.update({ where: { id: q.id }, data: { answerId: draft.id } });
    await startApplication(w.application.id, w.deps);
    expect(w.enqueued).toHaveLength(0);
    expect(await statusOf(w.application.id)).toBe("needs_answers");
  });

  it("makes the resume first when there is none (tailor + PDF)", async () => {
    const w = await makeApplyWorld({ withPdf: false });
    await startApplication(w.application.id, w.deps);
    expect(w.calls).toEqual({ tailor: 1, render: 1 });
    expect((await prisma.application.findUniqueOrThrow({ where: { id: w.application.id } })).resumeVersionId).not.toBeNull();
    expect(await statusOf(w.application.id)).toBe("approved");
  });

  it("tailor cap: tells me, undoes my tap and offers [Apply] again; no form is touched", async () => {
    const w = await makeApplyWorld({ withPdf: false });
    w.deps.tailorForJob = async () => {
      throw new TailorCapError("Daily tailor cap reached (20)");
    };
    await startApplication(w.application.id, w.deps);
    const app = await prisma.application.findUniqueOrThrow({ where: { id: w.application.id } });
    expect(app.approvedAt).toBeNull();
    expect(app.status).toBe("pending_approval");
    expect(w.sent[0].text).toContain("Daily tailor cap reached");
    expect(w.sent[0].buttons?.[0][0].data).toBe(CALLBACK.apply(w.application.id));
    expect(w.filler.prescanCalls).toHaveLength(0);
  });
});

describe("fillApplication safety rules", () => {
  async function readyWorld(opts: Parameters<typeof makeApplyWorld>[0] = {}) {
    const w = await makeApplyWorld({ status: "approved", ...opts });
    await bankAnswer(["notice period"], "60 days");
    w.filler.scan = { ok: true, fields: [...standardFields, noticeField], blocker: null };
    const q = await prisma.question.create({
      data: { applicationId: w.application.id, text: "Notice period", fieldName: "q_notice", fieldType: "text", required: true, status: "answered", askedVia: "bank", answerId: (await prisma.answer.findFirstOrThrow()).id },
    });
    void q;
    return w;
  }
  const approveSubmit = (id: number) => prisma.application.update({ where: { id }, data: { submitApprovedAt: new Date() } });

  it("DRY RUN: fills but never submits, even with submitApprovedAt set", async () => {
    const w = await readyWorld({ dryRun: true });
    await approveSubmit(w.application.id);
    await fillApplication(w.application.id, w.deps);
    expect(w.filler.fillCalls).toHaveLength(1);
    expect(w.filler.fillCalls[0].submit).toBe(false);
    const app = await prisma.application.findUniqueOrThrow({ where: { id: w.application.id } });
    expect(app.filledAt).toBeInstanceOf(Date);
    expect(app.submitLockedAt).toBeNull();
    expect(app.status).toBe("approved");
    expect(app.screenshotPath).toMatch(/\d+-\d+\.png$/);
    expect(await actionTypes()).toEqual(expect.arrayContaining(["apply.filled", "apply.dry_run"]));
    expect(await actionTypes("apply.submitted")).toHaveLength(0);
    const photo = w.sent.find((s) => s.kind === "photo")!;
    expect(photo.text).toContain("Dry run: filled, not submitted");
    expect(existsSync(photo.path!)).toBe(true);
  });

  it("passes standard + approved bank answers to the filler, keyed by field name", async () => {
    const w = await readyWorld();
    await fillApplication(w.application.id, w.deps);
    expect(w.filler.fillCalls[0].answers).toEqual({ first_name: "Asha", last_name: "Example", email: "asha@example.com", q_notice: "60 days" });
    expect(w.filler.fillCalls[0].resumePdfPath).toMatch(/resume\.pdf$/);
  });

  it("LIVE without my [Submit] tap: fills, sends the card with all answers, does NOT submit", async () => {
    const w = await readyWorld({ dryRun: false });
    await fillApplication(w.application.id, w.deps);
    expect(w.filler.submits).toBe(0);
    const card = w.sent.find((s) => s.kind === "photo")!;
    expect(card.buttons?.[0].map((b) => b.data)).toEqual([CALLBACK.submit(w.application.id), CALLBACK.cancel(w.application.id)]);
    expect(card.text).toContain("Notice period *: 60 days");
    expect(card.text).toContain("Email *: asha@example.com");
    expect((await prisma.application.findUniqueOrThrow({ where: { id: w.application.id } })).submitLockedAt).toBeNull();
    // a retry of the same job does not fill or send the card again
    await fillApplication(w.application.id, w.deps);
    expect(w.filler.fillCalls).toHaveLength(1);
  });

  it("LIVE with both taps: locks, submits once, records applied + screenshot + 'Applied to' message", async () => {
    const w = await readyWorld({ dryRun: false });
    await fillApplication(w.application.id, w.deps); // phase 1 (card)
    await approveSubmit(w.application.id);
    await fillApplication(w.application.id, w.deps); // phase 2
    expect(w.filler.submits).toBe(1);
    const app = await prisma.application.findUniqueOrThrow({ where: { id: w.application.id } });
    expect(app).toMatchObject({ status: "applied", method: "auto" });
    expect(app.appliedAt).toBeInstanceOf(Date);
    expect(app.submitLockedAt).toBeInstanceOf(Date);
    expect(await actionTypes("apply.submitted")).toHaveLength(1);
    expect(w.sent.at(-1)!.text).toMatch(/Applied to Backend Engineer at Acme\.\nFollow-up date: \d{4}-\d{2}-\d{2}/);
  });

  it("the lock stops a double submit: two workers racing, and a retry afterwards", async () => {
    const w = await readyWorld({ dryRun: false });
    await approveSubmit(w.application.id);
    await Promise.all([fillApplication(w.application.id, w.deps), fillApplication(w.application.id, w.deps)]);
    await fillApplication(w.application.id, w.deps);
    expect(w.filler.submits).toBe(1);
  });

  it("an existing recent lock (someone is submitting) blocks us, an old one goes manual instead of resubmitting", async () => {
    const w = await readyWorld({ dryRun: false });
    await approveSubmit(w.application.id);
    await prisma.application.update({ where: { id: w.application.id }, data: { submitLockedAt: new Date() } });
    await fillApplication(w.application.id, w.deps);
    expect(w.filler.fillCalls).toHaveLength(0);
    expect(await statusOf(w.application.id)).toBe("approved");

    await prisma.application.update({ where: { id: w.application.id }, data: { submitLockedAt: new Date(Date.now() - 3_600_000) } });
    await fillApplication(w.application.id, w.deps);
    expect(w.filler.fillCalls).toHaveLength(0);
    expect(await statusOf(w.application.id)).toBe("manual");
  });

  it("never fills without approvedAt", async () => {
    const w = await readyWorld({ dryRun: false, approved: false });
    await approveSubmit(w.application.id);
    await fillApplication(w.application.id, w.deps);
    expect(w.filler.fillCalls).toHaveLength(0);
  });

  it("only applications in 'approved' are touched (skipped/cancelled stay untouched)", async () => {
    const w = await readyWorld({ dryRun: false });
    await prisma.application.update({ where: { id: w.application.id }, data: { status: "skipped", submitApprovedAt: new Date() } });
    await fillApplication(w.application.id, w.deps);
    expect(w.filler.fillCalls).toHaveLength(0);
  });

  it("daily cap: blocks the fill, logs it, application stays approved", async () => {
    const w = await readyWorld({ dryRun: false });
    await prisma.settings.update({ where: { id: 1 }, data: { dailyCap: 2 } });
    for (let i = 0; i < 2; i++) {
      const { application } = await makeApplyWorldRow(i);
      await prisma.application.update({ where: { id: application.id }, data: { status: "applied", appliedAt: new Date() } });
    }
    await approveSubmit(w.application.id);
    await fillApplication(w.application.id, w.deps);
    expect(w.filler.fillCalls).toHaveLength(0);
    expect(await statusOf(w.application.id)).toBe("approved");
    expect(await actionTypes("apply.blocked_cap")).toHaveLength(1);
    expect(w.sent.at(-1)!.text).toContain("Daily cap reached (2/2)");
  });

  it("the cap can never exceed 15 even if settings say 100", async () => {
    const w = await readyWorld({ dryRun: true });
    await prisma.settings.update({ where: { id: 1 }, data: { dailyCap: 100 } });
    for (let i = 0; i < 15; i++) {
      const { application } = await makeApplyWorldRow(i);
      await prisma.application.update({ where: { id: application.id }, data: { status: "applied", appliedAt: new Date() } });
    }
    await fillApplication(w.application.id, w.deps);
    expect(w.filler.fillCalls).toHaveLength(0);
    expect(await actionTypes("apply.blocked_cap")).toHaveLength(1);
  });

  it("a CAPTCHA found in the fresh pre-scan -> manual, nothing filled", async () => {
    const w = await readyWorld({ dryRun: false });
    w.filler.scan = { ok: false, fields: [], blocker: "captcha" };
    await approveSubmit(w.application.id);
    await fillApplication(w.application.id, w.deps);
    expect(w.filler.fillCalls).toHaveLength(0);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: w.application.id } })).manualReason).toBe("captcha");
  });

  it("a required field with no approved answer -> manual 'unanswered' (never a guess)", async () => {
    const w = await readyWorld({ dryRun: true });
    w.filler.scan = { ok: true, fields: [...standardFields, noticeField, whyField], blocker: null };
    await fillApplication(w.application.id, w.deps);
    expect(w.filler.fillCalls).toHaveLength(0);
    const app = await prisma.application.findUniqueOrThrow({ where: { id: w.application.id } });
    expect(app).toMatchObject({ status: "manual", manualReason: "unanswered" });
  });

  it("a draft (unapproved) answer is never typed into a form", async () => {
    const w = await readyWorld({ dryRun: true });
    const draft = await prisma.answer.create({ data: { questionText: "why", rawAnswer: "UNAPPROVED TEXT", approved: false } });
    await prisma.question.create({ data: { applicationId: w.application.id, text: whyField.label, fieldName: "q_why", fieldType: "textarea", required: false, status: "asked", answerId: draft.id } });
    w.filler.scan = { ok: true, fields: [...standardFields, noticeField, { ...whyField, required: false }], blocker: null };
    await fillApplication(w.application.id, w.deps);
    expect(Object.values(w.filler.fillCalls[0].answers)).not.toContain("UNAPPROVED TEXT");
  });

  it("submit clicked but no confirmation: manual (error), screenshot saved, NEVER retried", async () => {
    const w = await readyWorld({ dryRun: false });
    w.filler.fillResult = { ok: false, submitted: false, error: "No confirmation page after submitting" };
    await approveSubmit(w.application.id);
    await fillApplication(w.application.id, w.deps);
    expect(await statusOf(w.application.id)).toBe("manual");
    expect(await actionTypes("apply.failed")).toHaveLength(1);
    await fillApplication(w.application.id, w.deps);
    expect(w.filler.submits).toBe(1);
  });

  it("exception while filling: apply.failed logged, status unchanged, I get a ping with the link", async () => {
    const w = await readyWorld({ dryRun: true });
    w.filler.fillError = new Error("Timeout waiting for #email");
    await fillApplication(w.application.id, w.deps);
    expect(await statusOf(w.application.id)).toBe("approved");
    expect(await actionTypes("apply.failed")).toHaveLength(1);
    const app = await prisma.application.findUniqueOrThrow({ where: { id: w.application.id } });
    expect(app.lastError).toContain("Timeout");
    expect(w.sent.at(-1)!.text).toContain("Timeout waiting for #email");
    expect(w.sent.at(-1)!.text).toContain("boards.greenhouse.io");
  });

  it("exception AFTER the lock: manual, because we can't know whether it went through", async () => {
    const w = await readyWorld({ dryRun: false });
    w.filler.fillError = new Error("browser crashed");
    await approveSubmit(w.application.id);
    await fillApplication(w.application.id, w.deps);
    expect(await statusOf(w.application.id)).toBe("manual");
    await fillApplication(w.application.id, w.deps);
    expect(w.filler.submits).toBe(1);
  });
});

// extra applications (other jobs) for cap tests
let rowCounter = 0;
async function makeApplyWorldRow(i: number) {
  const job = await prisma.job.create({ data: { company: `Other${i}-${rowCounter++}`, title: "Dev", description: "x" } });
  const application = await prisma.application.create({ data: { jobId: job.id, status: "applied", idempotencyKey: `apply:${job.id}` } });
  return { job, application };
}
