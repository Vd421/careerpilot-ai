import { QUEUES, type ApproveAnswer, type Enqueue, canTransition, type SubmitRawAnswer } from "../contracts.js";
import { prisma } from "../db.js";
import { logAction } from "../telegram/log.js";
import { mapToOption, normalizeQuestion } from "./normalize.js";
import { claudePolish, polishAnswer, type PolishModel } from "./polish.js";

export class AnswerError extends Error {
  name = "AnswerError";
}

export interface AnswerDeps {
  polishModel?: PolishModel;
  enqueue?: Enqueue;
}

const DRAFT = "draft";
const EDITING = "editing"; // I tapped [Edit]: my next reply is saved as-is

async function realEnqueue(...a: Parameters<Enqueue>) {
  return (await import("../queue/index.js")).enqueue(...a);
}

async function loadQuestion(questionId: number) {
  const q = await prisma.question.findUnique({
    where: { id: questionId },
    include: { answer: true, application: { include: { job: true } } },
  });
  if (!q) throw new AnswerError(`Question ${questionId} not found`);
  return q;
}

// An Answer row that is still a draft (not approved). Never touches an approved bank row.
async function upsertDraft(questionId: number, data: { rawAnswer: string; polishedAnswer: string | null }) {
  const q = await loadQuestion(questionId);
  const qn = normalizeQuestion(q.text);
  if (q.answer && !q.answer.approved) {
    return prisma.answer.update({
      where: { id: q.answer.id },
      data: { ...data, tags: [DRAFT] },
    });
  }
  const draft = await prisma.answer.create({
    data: { questionText: qn, patterns: [], approved: false, reusable: false, tags: [DRAFT], ...data },
  });
  await prisma.question.update({ where: { id: questionId }, data: { answerId: draft.id } });
  return draft;
}

// ---------------------------------------------------------------------------
// submitRawAnswer: my rough words -> polished text (grammar/tone only, checked in code)
// ---------------------------------------------------------------------------
export function makeSubmitRawAnswer(deps: AnswerDeps = {}): SubmitRawAnswer {
  return async (questionId, rawAnswer) => {
    const raw = rawAnswer.trim();
    if (!raw) throw new AnswerError("Answer is empty");
    const q = await loadQuestion(questionId);

    // Fixed-choice fields: no polishing, the answer must BE one of the options.
    if ((q.fieldType === "select" || q.fieldType === "radio") && q.options.length > 0) {
      const option = mapToOption(raw, q.options);
      if (!option) throw new AnswerError(`Please answer with one of: ${q.options.join(" / ")}`);
      await upsertDraft(questionId, { rawAnswer: raw, polishedAnswer: option });
      await logAction("question.answered", { jobId: q.application.jobId, applicationId: q.applicationId }, { questionId, option: true });
      return { polished: option };
    }

    const outcome = await polishAnswer(q.text, raw, deps.polishModel ?? claudePolish, async (r) => {
      await prisma.aiCall.create({
        data: { purpose: "polish", model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, jobId: q.application.jobId },
      });
    });
    await upsertDraft(questionId, { rawAnswer: raw, polishedAnswer: outcome.usable ? outcome.polished : null });
    await logAction("question.answered", { jobId: q.application.jobId, applicationId: q.applicationId }, { questionId });
    await logAction(
      "answer.polished",
      { jobId: q.application.jobId, applicationId: q.applicationId },
      { questionId, offered: outcome.usable, rejectedBecause: outcome.newFacts },
    );
    return { polished: outcome.polished };
  };
}

// ---------------------------------------------------------------------------
// approveAnswer: my choice becomes an approved Answer, linked to the question
// ---------------------------------------------------------------------------
export function makeApproveAnswer(deps: AnswerDeps = {}): ApproveAnswer {
  return async (questionId, choice, reusable) => {
    const enqueue = deps.enqueue ?? realEnqueue;
    const q = await loadQuestion(questionId);

    let final: string;
    let raw: string;
    if (typeof choice === "object") {
      final = choice.edited.trim();
      raw = q.answer?.rawAnswer ?? final;
    } else {
      const draft = q.answer && !q.answer.approved ? q.answer : null;
      if (!draft) throw new AnswerError("No answer to approve yet. Send your answer first.");
      raw = draft.rawAnswer;
      final = choice === "original" ? draft.rawAnswer.trim() : (draft.polishedAnswer ?? "").trim();
      if (choice === "polished" && !final) throw new AnswerError("There is no polished version to use.");
    }
    if (!final) throw new AnswerError("Answer is empty");
    if ((q.fieldType === "select" || q.fieldType === "radio") && q.options.length > 0) {
      const option = mapToOption(final, q.options);
      if (!option) throw new AnswerError(`Answer must be one of: ${q.options.join(" / ")}`);
      final = option;
    }

    const qn = normalizeQuestion(q.text);
    const polishedField = final === raw.trim() ? null : final; // null = "my original words"

    // Saving for the future: update the existing bank row for this question instead of duplicating it.
    const existing = reusable
      ? await prisma.answer.findFirst({ where: { approved: true, reusable: true, questionText: qn, NOT: { id: q.answer?.id ?? -1 } } })
      : null;

    let answerId: number;
    if (existing) {
      await prisma.answer.update({ where: { id: existing.id }, data: { rawAnswer: raw, polishedAnswer: polishedField, tags: [] } });
      if (q.answer && !q.answer.approved) await prisma.answer.delete({ where: { id: q.answer.id } }).catch(() => {});
      answerId = existing.id;
    } else if (q.answer && !q.answer.approved) {
      await prisma.answer.update({
        where: { id: q.answer.id },
        data: { approved: true, reusable, rawAnswer: raw, polishedAnswer: polishedField, questionText: qn, tags: [] },
      });
      answerId = q.answer.id;
    } else {
      const created = await prisma.answer.create({
        data: { questionText: qn, rawAnswer: raw, polishedAnswer: polishedField, approved: true, reusable, tags: [] },
      });
      answerId = created.id;
    }

    await prisma.question.update({ where: { id: questionId }, data: { answerId, status: "answered" } });
    await logAction("answer.approved", { jobId: q.application.jobId, applicationId: q.applicationId }, { questionId, answerId, reusable });

    await maybeReady(q.applicationId, enqueue);
  };
}

// When the last REQUIRED question is answered: needs_answers -> approved, then queue the fill.
export async function maybeReady(applicationId: number, enqueue: Enqueue): Promise<boolean> {
  const open = await prisma.question.count({ where: { applicationId, required: true, status: { not: "answered" } } });
  if (open > 0) return false;
  const app = await prisma.application.findUniqueOrThrow({ where: { id: applicationId } });
  if (app.status === "needs_answers" && canTransition("needs_answers", "approved")) {
    await prisma.application.update({ where: { id: applicationId }, data: { status: "approved" } });
    await enqueue(QUEUES.fill, { applicationId }, { singletonKey: `fill:${applicationId}` });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Telegram helpers: the [Edit] flow and routing a plain reply to a question
// ---------------------------------------------------------------------------

// [Edit] tapped: remember (in the DB, so a restart doesn't lose it) that my next reply is the final text.
export async function markEditing(questionId: number): Promise<void> {
  const q = await loadQuestion(questionId);
  if (!q.answer || q.answer.approved) throw new AnswerError("Nothing to edit");
  await prisma.answer.update({ where: { id: q.answer.id }, data: { tags: [EDITING] } });
}

export async function editingQuestionId(): Promise<number | null> {
  const a = await prisma.answer.findFirst({
    where: { approved: false, tags: { has: EDITING }, questions: { some: {} } },
    orderBy: { updatedAt: "asc" },
    include: { questions: true },
  });
  return a?.questions[0]?.id ?? null;
}

// My edited text is saved as-is (no polishing, no checks): it becomes the "polished" candidate to approve.
export async function saveEditedDraft(questionId: number, text: string): Promise<string> {
  const q = await loadQuestion(questionId);
  const edited = text.trim();
  if (!edited) throw new AnswerError("Edited answer is empty");
  if ((q.fieldType === "select" || q.fieldType === "radio") && q.options.length > 0) {
    const option = mapToOption(edited, q.options);
    if (!option) throw new AnswerError(`Please answer with one of: ${q.options.join(" / ")}`);
    await upsertDraft(questionId, { rawAnswer: q.answer?.rawAnswer ?? edited, polishedAnswer: option });
    return option;
  }
  await upsertDraft(questionId, { rawAnswer: q.answer?.rawAnswer ?? edited, polishedAnswer: edited });
  return edited;
}

// "Asked" questions still waiting for my first reply (no draft yet), oldest first.
export async function oldestAwaitingQuestionId(): Promise<number | null> {
  const q = await prisma.question.findFirst({
    where: { status: "asked", answerId: null },
    orderBy: { id: "asc" },
  });
  return q?.id ?? null;
}

export const submitRawAnswer: SubmitRawAnswer = (id, raw) => makeSubmitRawAnswer()(id, raw);
export const approveAnswer: ApproveAnswer = (id, choice, reusable) => makeApproveAnswer()(id, choice, reusable);
