import { existsSync } from "node:fs";
import { HARD_DAILY_CAP, QUEUES, canTransition } from "../contracts.js";
import { prisma } from "../db.js";
import {
  AnswerError,
  editingQuestionId,
  markEditing,
  oldestAwaitingQuestionId,
  saveEditedDraft,
} from "../answers/index.js";
import { resolveRepoPath } from "../tailor/paths.js";
import { answerChoiceButtons, reuseButtons } from "./questions.js";
import { logAction } from "./log.js";
import type { TelegramDeps } from "./types.js";

// What the bot layer shows when a button is tapped (answerCallbackQuery) and whether to strip the buttons.
export interface CallbackOutcome {
  toast: string;
  clearButtons: boolean;
}

const done = (toast: string, clearButtons = true): CallbackOutcome => ({ toast, clearButtons });

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// "daily tailor cap reached" is the one tailoring failure with its own wording (lead's request).
async function isCapError(err: unknown): Promise<boolean> {
  const { TailorCapError } = await import("../tailor/index.js");
  return err instanceof TailorCapError;
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export async function handleCallback(deps: TelegramDeps, data: string): Promise<CallbackOutcome> {
  const [action, idText, extra, extra2] = data.split(":");
  const id = Number(idText);
  if (!Number.isInteger(id)) return done("Unknown button", false);

  switch (action) {
    case "apply":
      return onApply(deps, id);
    case "skip":
      return onSkip(deps, id);
    case "resume":
      return onViewResume(deps, id);
    case "submit":
      return onSubmit(deps, id);
    case "cancel":
      return onCancel(deps, id);
    case "ans_use":
      return onAnswerChoice(deps, id, "p");
    case "ans_orig":
      return onAnswerChoice(deps, id, "o");
    case "ans_edit":
      return onAnswerEdit(deps, id);
    case "ans_save":
      return onAnswerSave(deps, id, extra, extra2);
    default:
      return done("Unknown button", false);
  }
}

async function onApply(deps: TelegramDeps, applicationId: number): Promise<CallbackOutcome> {
  // Atomic: only the FIRST tap on a pending application wins, a second tap changes nothing.
  const claimed = await prisma.application.updateMany({
    where: { id: applicationId, status: "pending_approval", approvedAt: null },
    data: { approvedAt: new Date() },
  });
  if (claimed.count === 0) return done("Already handled");

  const app = await prisma.application.findUniqueOrThrow({ where: { id: applicationId } });
  await logAction("telegram.tap", { jobId: app.jobId, applicationId }, { button: "apply" });
  await logAction("application.approved", { jobId: app.jobId, applicationId, loopId: app.loopId });
  await deps.enqueue(QUEUES.prescan, { applicationId }, { singletonKey: `prescan:${applicationId}` });
  return done("Applying: checking the form...");
}

async function onSkip(deps: TelegramDeps, applicationId: number): Promise<CallbackOutcome> {
  const app = await prisma.application.findUnique({ where: { id: applicationId } });
  if (!app) return done("Application not found");
  await logAction("telegram.tap", { jobId: app.jobId, applicationId }, { button: "skip" });
  if (app.status === "skipped") return done("Already skipped");
  if (!canTransition(app.status as never, "skipped")) return done(`Can't skip (status: ${app.status})`);
  await prisma.application.update({ where: { id: applicationId }, data: { status: "skipped" } });
  await logAction("application.skipped", { jobId: app.jobId, applicationId, loopId: app.loopId });
  return done("Skipped");
}

async function onViewResume(deps: TelegramDeps, applicationId: number): Promise<CallbackOutcome> {
  const app = await prisma.application.findUnique({ where: { id: applicationId }, include: { resumeVersion: true, job: true } });
  if (!app) return done("Application not found", false);
  await logAction("telegram.tap", { jobId: app.jobId, applicationId }, { button: "view_resume" });
  try {
    let version = app.resumeVersion;
    if (!version) {
      const { resumeVersionId } = await deps.tailorForJob(app.jobId, app.resumeVariantId ?? undefined);
      version = await prisma.resumeVersion.findUniqueOrThrow({ where: { id: resumeVersionId } });
    }
    let pdfPath = version.pdfPath;
    if (!pdfPath || !existsSync(resolveRepoPath(pdfPath))) {
      pdfPath = (await deps.renderResumePdf(version.id)).pdfPath;
    }
    await deps.client.sendDocument(resolveRepoPath(pdfPath), `Resume for ${app.job.title} at ${app.job.company}`, { applicationId });
    return done("Resume sent", false); // the card keeps its buttons
  } catch (err) {
    if (await isCapError(err)) {
      await deps.client.sendMessage("Daily tailor cap reached. Try again tomorrow, or raise the cap in Settings.", undefined, { applicationId });
      return done("Daily tailor cap reached", false);
    }
    await deps.client.sendMessage(`Couldn't make the resume: ${(err as Error).message}`, undefined, { applicationId });
    return done("Resume failed", false);
  }
}

// [Submit] on the "ready to submit" card: the second human tap. Recorded, then the fill job runs with submit=true.
async function onSubmit(deps: TelegramDeps, applicationId: number): Promise<CallbackOutcome> {
  const app = await prisma.application.findUnique({ where: { id: applicationId } });
  if (!app) return done("Application not found");
  await logAction("telegram.tap", { jobId: app.jobId, applicationId }, { button: "submit" });
  const claimed = await prisma.application.updateMany({
    where: { id: applicationId, status: "approved", approvedAt: { not: null }, filledAt: { not: null }, submitApprovedAt: null },
    data: { submitApprovedAt: new Date() },
  });
  if (claimed.count === 0) return done("Nothing to submit (already handled?)");
  await logAction("apply.submit_approved", { jobId: app.jobId, applicationId, loopId: app.loopId });
  await deps.enqueue(QUEUES.fill, { applicationId }, { singletonKey: `fill:${applicationId}:submit` });
  return done("Submitting...");
}

async function onCancel(deps: TelegramDeps, applicationId: number): Promise<CallbackOutcome> {
  void deps;
  const app = await prisma.application.findUnique({ where: { id: applicationId } });
  if (!app) return done("Application not found");
  await logAction("telegram.tap", { jobId: app.jobId, applicationId }, { button: "cancel" });
  // Never cancel something that was already submitted or locked for submit.
  if (app.submitLockedAt || app.status === "applied") return done("Too late, it is already being submitted");
  if (!canTransition(app.status as never, "skipped")) return done(`Can't cancel (status: ${app.status})`);
  await prisma.application.update({ where: { id: applicationId }, data: { status: "skipped" } });
  await logAction("application.skipped", { jobId: app.jobId, applicationId, loopId: app.loopId }, { via: "cancel" });
  return done("Cancelled, nothing was submitted");
}

// ---------------------------------------------------------------------------
// Answer buttons
// ---------------------------------------------------------------------------

async function onAnswerChoice(deps: TelegramDeps, questionId: number, choice: "p" | "o"): Promise<CallbackOutcome> {
  const q = await prisma.question.findUnique({ where: { id: questionId } });
  if (!q) return done("Question not found");
  if (q.status === "answered") return done("Already answered");
  await deps.client.sendMessage("Save this answer for future jobs?", reuseButtons(questionId, choice), {
    applicationId: q.applicationId,
    questionId,
  });
  return done(choice === "p" ? "Using polished version" : "Using your original");
}

async function onAnswerEdit(deps: TelegramDeps, questionId: number): Promise<CallbackOutcome> {
  const q = await prisma.question.findUnique({ where: { id: questionId } });
  if (!q) return done("Question not found");
  try {
    await markEditing(questionId);
  } catch (err) {
    return done((err as Error).message, false);
  }
  await deps.client.sendMessage("Send the edited version (I'll save it exactly as you write it).", undefined, {
    applicationId: q.applicationId,
    questionId,
  });
  return done("Waiting for your edit");
}

async function onAnswerSave(deps: TelegramDeps, questionId: number, choice: string, reusable: string): Promise<CallbackOutcome> {
  const q = await prisma.question.findUnique({ where: { id: questionId } });
  if (!q) return done("Question not found");
  if (q.status === "answered") return done("Already answered");
  try {
    await deps.approveAnswer(questionId, choice === "o" ? "original" : "polished", reusable === "y");
  } catch (err) {
    if (err instanceof AnswerError) {
      await deps.client.sendMessage(err.message, undefined, { applicationId: q.applicationId, questionId });
      return done("Couldn't save", false);
    }
    throw err;
  }
  return done(reusable === "y" ? "Saved for future jobs" : "Saved for this job only");
}

// ---------------------------------------------------------------------------
// Text replies
// ---------------------------------------------------------------------------

// Which question does this reply belong to?
//  1) a swipe-reply to a message we saved with a questionId
//  2) the question I tapped [Edit] on
//  3) the oldest asked question that has no answer yet
export async function routeReply(replyToMessageId: number | undefined): Promise<{ questionId: number; editing: boolean } | null> {
  const editing = await editingQuestionId();
  if (replyToMessageId !== undefined) {
    const msg = await prisma.telegramMessage.findFirst({
      where: { direction: "out", chatMessageId: replyToMessageId, questionId: { not: null } },
    });
    if (msg?.questionId) return { questionId: msg.questionId, editing: editing === msg.questionId };
  }
  if (editing !== null) return { questionId: editing, editing: true };
  const oldest = await oldestAwaitingQuestionId();
  return oldest !== null ? { questionId: oldest, editing: false } : null;
}

export async function handleText(deps: TelegramDeps, text: string, replyToMessageId?: number): Promise<void> {
  const route = await routeReply(replyToMessageId);
  if (!route) {
    await deps.client.sendMessage("Nothing is waiting for an answer. Try /pending.");
    return;
  }
  const q = await prisma.question.findUniqueOrThrow({ where: { id: route.questionId } });
  const ctx = { applicationId: q.applicationId, questionId: q.id };
  try {
    if (route.editing) {
      const saved = await saveEditedDraft(q.id, text);
      await deps.client.sendMessage(`Edited answer:\n${saved}\n\nSave it for future jobs?`, reuseButtons(q.id, "p"), ctx);
      return;
    }
    const { polished } = await deps.submitRawAnswer(q.id, text);
    const same = polished.trim() === text.trim();
    const body = same
      ? `Your answer:\n${text.trim()}\n\n(No safe polish to offer.)`
      : `Your answer:\n${text.trim()}\n\nPolished:\n${polished}`;
    await deps.client.sendMessage(body, answerChoiceButtons(q.id, !same), ctx);
  } catch (err) {
    if (err instanceof AnswerError) {
      await deps.client.sendMessage(err.message, undefined, ctx);
      return;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export async function statusText(): Promise<string> {
  const s = await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  const since = startOfToday();
  const [applied, pending, needs, ready, manual, discovered] = await Promise.all([
    prisma.application.count({ where: { status: "applied", appliedAt: { gte: since } } }),
    prisma.application.count({ where: { status: "pending_approval" } }),
    prisma.application.count({ where: { status: "needs_answers" } }),
    prisma.application.count({ where: { status: "approved", filledAt: { not: null }, appliedAt: null } }),
    prisma.application.count({ where: { status: "manual" } }),
    prisma.job.count({ where: { createdAt: { gte: since } } }),
  ]);
  const cap = Math.min(s.dailyCap, HARD_DAILY_CAP);
  return [
    `Today: ${discovered} jobs found, ${applied}/${cap} applied`,
    `Waiting for you: ${pending} to approve, ${needs} need answers, ${ready} ready to submit`,
    `Manual: ${manual}`,
    `Mode: ${s.dryRun ? "DRY RUN (nothing is submitted)" : "LIVE"}`,
  ].join("\n");
}

export async function pendingText(): Promise<string> {
  const [apps, questions, ready] = await Promise.all([
    prisma.application.findMany({ where: { status: "pending_approval" }, include: { job: true }, orderBy: { id: "asc" }, take: 15 }),
    prisma.question.findMany({ where: { status: "asked" }, include: { application: { include: { job: true } } }, orderBy: { id: "asc" }, take: 15 }),
    prisma.application.findMany({ where: { status: "approved", filledAt: { not: null }, appliedAt: null }, include: { job: true }, take: 10 }),
  ]);
  const lines: string[] = [];
  if (apps.length) lines.push("To approve:", ...apps.map((a) => `- ${a.job.title} at ${a.job.company} (#${a.id})`));
  if (ready.length) lines.push("Ready to submit:", ...ready.map((a) => `- ${a.job.title} at ${a.job.company} (#${a.id})`));
  if (questions.length) lines.push("Questions waiting:", ...questions.map((q) => `- ${q.application.job.company}: ${q.text.slice(0, 80)}`));
  return lines.length ? lines.join("\n") : "Nothing is waiting for you.";
}

// /pause and /resume: every loop, or one loop by name.
export async function setLoopsActive(deps: TelegramDeps, active: boolean, name?: string): Promise<string> {
  const where = name ? { name: { equals: name, mode: "insensitive" as const } } : {};
  const loops = await prisma.loop.findMany({ where });
  if (loops.length === 0) return name ? `No loop named "${name}".` : "No loops yet.";
  await prisma.loop.updateMany({ where: { id: { in: loops.map((l) => l.id) } }, data: { active } });
  for (const l of loops) {
    await logAction(active ? "loop.resumed" : "loop.paused", { loopId: l.id }, { via: "telegram" });
  }
  await deps.syncLoopSchedules();
  const label = loops.map((l) => l.name).join(", ");
  return `${active ? "Resumed" : "Paused"}: ${label}`;
}

export async function handleCommand(deps: TelegramDeps, command: string, args: string): Promise<string> {
  switch (command) {
    case "status":
      return statusText();
    case "pending":
      return pendingText();
    case "pause":
      return setLoopsActive(deps, false, args.trim() || undefined);
    case "resume":
      return setLoopsActive(deps, true, args.trim() || undefined);
    default:
      return "Commands: /status /pending /pause [loop] /resume [loop]";
  }
}
