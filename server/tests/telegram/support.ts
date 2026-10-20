import type { InlineButton, Enqueue } from "../../src/contracts.js";
import { makeApproveAnswer, makeSubmitRawAnswer, type PolishModel } from "../../src/answers/index.js";
import type { ModelResult } from "../../src/ai/client.js";
import { prisma } from "../../src/db.js";
import { createTelegramClient } from "../../src/telegram/client.js";
import type { RawTelegram, TelegramDeps } from "../../src/telegram/types.js";

export interface Sent {
  kind: "message" | "photo" | "document";
  chatId: string;
  text: string; // message text, or caption
  path?: string;
  buttons?: InlineButton[][];
  messageId: number;
}

// Fake Telegram wire: records everything, hands out increasing message ids.
export function fakeRaw() {
  const sent: Sent[] = [];
  let next = 100;
  const raw: RawTelegram = {
    async sendMessage(chatId, text, buttons) {
      sent.push({ kind: "message", chatId, text, buttons, messageId: ++next });
      return next;
    },
    async sendPhoto(chatId, path, caption, buttons) {
      sent.push({ kind: "photo", chatId, text: caption, path, buttons, messageId: ++next });
      return next;
    },
    async sendDocument(chatId, path, caption) {
      sent.push({ kind: "document", chatId, text: caption, path, messageId: ++next });
      return next;
    },
  };
  return { raw, sent };
}

export const modelResult = (output: unknown): ModelResult => ({
  output,
  model: "fake-model",
  inputTokens: 10,
  outputTokens: 5,
  stopReason: "end_turn",
});

// A fake polisher: returns whatever `polished` you give it (or a function of the raw answer).
export function fakePolish(polished: string | ((rawText: string) => string)): PolishModel {
  return async (_system, user) => {
    const rawText = user.split("Rough answer:\n")[1] ?? "";
    return modelResult({ polished: typeof polished === "function" ? polished(rawText) : polished });
  };
}

export interface TestWorld {
  deps: TelegramDeps;
  sent: Sent[];
  enqueued: { name: string; data: Record<string, unknown>; opts?: { singletonKey?: string } }[];
  tailorCalls: number[];
  renderCalls: number[];
}

export function makeWorld(over: Partial<TelegramDeps> & { polish?: PolishModel } = {}): TestWorld {
  const { raw, sent } = fakeRaw();
  const enqueued: TestWorld["enqueued"] = [];
  const tailorCalls: number[] = [];
  const renderCalls: number[] = [];
  const enqueue: Enqueue = async (name, data, opts) => {
    enqueued.push({ name, data, opts });
  };
  const deps: TelegramDeps = {
    client: createTelegramClient(raw),
    enqueue,
    tailorForJob: async (jobId) => {
      tailorCalls.push(jobId);
      const v = await prisma.resumeVersion.create({ data: { jobId, tailored: {} } });
      return { resumeVersionId: v.id };
    },
    renderResumePdf: async (id) => {
      renderCalls.push(id);
      return { pdfPath: "package.json" }; // any file that exists relative to the repo? see below
    },
    submitRawAnswer: makeSubmitRawAnswer({ polishModel: over.polish ?? fakePolish((r) => r) }),
    approveAnswer: makeApproveAnswer({ enqueue }),
    syncLoopSchedules: async () => {},
    ...over,
  };
  return { deps, sent, enqueued, tailorCalls, renderCalls };
}

export async function linkChat(chatId = "42") {
  await prisma.settings.upsert({ where: { id: 1 }, update: { telegramChatId: chatId }, create: { id: 1, telegramChatId: chatId } });
}

export async function makeApplication(over: { status?: string; jobData?: Record<string, unknown> } = {}) {
  const job = await prisma.job.create({
    data: {
      company: "Acme",
      title: "Backend Engineer",
      description: "Node and Postgres",
      url: "https://boards.greenhouse.io/acme/jobs/1",
      source: "greenhouse",
      applyPlatform: "greenhouse",
      matchScore: 82,
      summary: "Strong Node and Postgres match; no Kafka.",
      redFlags: [{ type: "seniority", detail: "Asks for 3+ years" }],
      salaryMin: 1500000,
      salaryMax: 2200000,
      salaryCurrency: "INR",
      remote: true,
      ...over.jobData,
    },
  });
  const application = await prisma.application.create({
    data: { jobId: job.id, status: over.status ?? "pending_approval", idempotencyKey: `apply:${job.id}` },
  });
  return { job, application };
}

export async function makeQuestion(
  applicationId: number,
  over: { text?: string; fieldType?: string; options?: string[]; required?: boolean; status?: string; fieldName?: string } = {},
) {
  return prisma.question.create({
    data: {
      applicationId,
      text: over.text ?? "Why do you want to work here?",
      fieldName: over.fieldName ?? `q_${Math.random().toString(36).slice(2, 8)}`,
      fieldType: over.fieldType ?? "textarea",
      options: over.options ?? [],
      required: over.required ?? true,
      status: over.status ?? "pending",
    },
  });
}
