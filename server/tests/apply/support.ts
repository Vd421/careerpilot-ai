import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { FillResult, FormField, PrescanResult } from "../../src/contracts.js";
import { loadResume } from "../../src/resume/load.js";
import type { ApplyDeps, FillRequestX, FormFillerX } from "../../src/apply/types.js";
import { prisma } from "../../src/db.js";
import { createTelegramClient } from "../../src/telegram/client.js";
import { askQuestionWith } from "../../src/telegram/questions.js";
import { fakeRaw, linkChat, makeApplication } from "../telegram/support.js";

export const exampleResume = loadResume(resolve(import.meta.dirname, "../../../data/resume.example.json"));

export const field = (over: Partial<FormField> & { name: string; label: string }): FormField => ({
  type: "text",
  required: false,
  options: [],
  ...over,
});

// The fields a typical Greenhouse form has: standard ones + custom questions.
export const standardFields: FormField[] = [
  field({ name: "first_name", label: "First Name", required: true }),
  field({ name: "last_name", label: "Last Name", required: true }),
  field({ name: "email", label: "Email", required: true }),
  field({ name: "resume", label: "Resume/CV", type: "file", required: true }),
];

export class FakeFiller implements FormFillerX {
  prescanCalls: { url: string; platform: string }[] = [];
  fillCalls: FillRequestX[] = [];
  scan: PrescanResult = { ok: true, fields: standardFields, blocker: null };
  fillResult: Partial<FillResult> = {};
  fillError: Error | null = null;

  async prescan(url: string, platform: string): Promise<PrescanResult> {
    this.prescanCalls.push({ url, platform });
    return this.scan;
  }
  async fill(req: FillRequestX): Promise<FillResult> {
    this.fillCalls.push(req);
    if (this.fillError) throw this.fillError;
    if (req.screenshotPath) {
      mkdirSync(resolve(req.screenshotPath, ".."), { recursive: true });
      writeFileSync(req.screenshotPath, "fake png");
    }
    return {
      ok: true,
      submitted: req.submit,
      screenshotPath: req.screenshotPath ?? null,
      blocker: null,
      error: null,
      ...this.fillResult,
    };
  }
  get submits() {
    return this.fillCalls.filter((c) => c.submit).length;
  }
}

export async function makeApplyWorld(opts: { status?: string; platform?: string; approved?: boolean; withPdf?: boolean; dryRun?: boolean } = {}) {
  await linkChat();
  const dir = mkdtempSync(join(tmpdir(), "apply-"));
  const { raw, sent } = fakeRaw();
  const telegram = createTelegramClient(raw);
  const filler = new FakeFiller();
  const enqueued: { name: string; data: Record<string, unknown> }[] = [];
  const calls = { tailor: 0, render: 0 };

  const { job, application } = await makeApplication({
    status: opts.status ?? "pending_approval",
    jobData: { applyPlatform: opts.platform ?? "greenhouse" },
  });
  const pdfPath = join(dir, "resume.pdf");
  if (opts.withPdf !== false) {
    writeFileSync(pdfPath, "%PDF-fake");
    const version = await prisma.resumeVersion.create({ data: { jobId: job.id, tailored: {}, pdfPath } });
    await prisma.application.update({ where: { id: application.id }, data: { resumeVersionId: version.id } });
  }
  if (opts.approved !== false) await prisma.application.update({ where: { id: application.id }, data: { approvedAt: new Date() } });
  await prisma.settings.upsert({ where: { id: 1 }, update: { dryRun: opts.dryRun ?? true }, create: { id: 1, dryRun: opts.dryRun ?? true } });

  const deps: ApplyDeps = {
    filler,
    telegram,
    askQuestion: (id) => askQuestionWith(telegram, id),
    tailorForJob: async (jobId) => {
      calls.tailor++;
      writeFileSync(pdfPath, "%PDF-fake");
      const v = await prisma.resumeVersion.create({ data: { jobId, tailored: {} } });
      return { resumeVersionId: v.id };
    },
    renderResumePdf: async (id) => {
      calls.render++;
      await prisma.resumeVersion.update({ where: { id }, data: { pdfPath } });
      return { pdfPath };
    },
    enqueue: async (name, data) => void enqueued.push({ name, data }),
    loadResume: () => exampleResume,
    classifier: async () => ({ output: { key: "none" }, model: "fake", inputTokens: 1, outputTokens: 1, stopReason: "end_turn" }),
    screenshotsDir: join(dir, "screenshots"),
  };
  return { deps, filler, sent, enqueued, calls, job, application, dir };
}

export const statusOf = async (id: number) => (await prisma.application.findUniqueOrThrow({ where: { id } })).status;
export const actionTypes = async (type?: string) =>
  (await prisma.agentAction.findMany({ where: type ? { type } : {}, orderBy: { id: "asc" } })).map((a) => a.type);
