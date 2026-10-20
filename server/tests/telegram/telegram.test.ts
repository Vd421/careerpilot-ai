import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { CALLBACK } from "../../src/contracts.js";
import { prisma } from "../../src/db.js";
import { TailorCapError } from "../../src/tailor/index.js";
import { authorizeChat } from "../../src/telegram/bot.js";
import { sendJobCardWith } from "../../src/telegram/card.js";
import { createTelegramClient } from "../../src/telegram/client.js";
import { handleCallback, handleCommand, handleText } from "../../src/telegram/handlers.js";
import { askQuestionWith } from "../../src/telegram/questions.js";
import { resetDb } from "../helpers/resetDb.js";
import { fakePolish, fakeRaw, linkChat, makeApplication, makeQuestion, makeWorld } from "./support.js";

const actions = async (type?: string) =>
  (await prisma.agentAction.findMany({ where: type ? { type } : {}, orderBy: { id: "asc" } })).map((a) => a.type);

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("chat-id lock", () => {
  it("first /start links the chat; anything else before that is ignored", async () => {
    expect(await authorizeChat(7, false)).toBe("ignore");
    expect((await prisma.settings.findUnique({ where: { id: 1 } }))?.telegramChatId ?? null).toBeNull();
    expect(await authorizeChat(7, true)).toBe("linked");
    expect((await prisma.settings.findUnique({ where: { id: 1 } }))?.telegramChatId).toBe("7");
  });

  it("after linking, only that chat is obeyed (even /start from a stranger)", async () => {
    await authorizeChat(7, true);
    expect(await authorizeChat(7, false)).toBe("ok");
    expect(await authorizeChat(99, false)).toBe("ignore");
    expect(await authorizeChat(99, true)).toBe("ignore");
    expect((await prisma.settings.findUnique({ where: { id: 1 } }))?.telegramChatId).toBe("7");
  });

  it("two racing /start messages can't both link", async () => {
    const results = await Promise.all([authorizeChat(1, true), authorizeChat(2, true)]);
    expect(results.filter((r) => r === "linked")).toHaveLength(1);
  });
});

describe("TelegramClient", () => {
  it("saves every outgoing message with its application/question", async () => {
    await linkChat();
    const { application } = await makeApplication();
    const { raw, sent } = fakeRaw();
    const client = createTelegramClient(raw);
    const { messageId } = await client.sendMessage("hello", undefined, { applicationId: application.id });
    await client.sendDocument("x.pdf", "resume", { applicationId: application.id });
    expect(sent.map((s) => s.chatId)).toEqual(["42", "42"]);
    const rows = await prisma.telegramMessage.findMany({ orderBy: { id: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ direction: "out", text: "hello", chatMessageId: messageId, applicationId: application.id });
  });

  it("drops the message (no crash) when no chat is linked", async () => {
    const { raw, sent } = fakeRaw();
    const res = await createTelegramClient(raw).sendMessage("hello");
    expect(res.messageId).toBe(0);
    expect(sent).toHaveLength(0);
    expect(await prisma.telegramMessage.count()).toBe(0);
  });
});

describe("job card", () => {
  it("shows role, company, match, why, red flags, salary, source, link and the three buttons", async () => {
    await linkChat();
    const { application } = await makeApplication();
    const w = makeWorld();
    await sendJobCardWith(w.deps.client, application.id);
    const msg = w.sent[0];
    expect(msg.text).toContain("Backend Engineer - Acme");
    expect(msg.text).toContain("Match 82%");
    expect(msg.text).toContain("Strong Node and Postgres match");
    expect(msg.text).toContain("seniority (Asks for 3+ years)");
    expect(msg.text).toContain("INR 1,500,000-2,200,000 / year");
    expect(msg.text).toContain("https://boards.greenhouse.io/acme/jobs/1");
    expect(msg.buttons?.[0].map((b) => b.data)).toEqual([
      CALLBACK.apply(application.id),
      CALLBACK.skip(application.id),
      CALLBACK.viewResume(application.id),
    ]);
    expect(await actions("telegram.card_sent")).toHaveLength(1);
  });

  it("adds the source attribution for sources whose terms require it", async () => {
    await linkChat();
    const { application } = await makeApplication({ jobData: { source: "remotive", applyPlatform: "other" } });
    const w = makeWorld();
    await sendJobCardWith(w.deps.client, application.id);
    expect(w.sent[0].text).toContain("Remotive");
  });
});

describe("[Apply]", () => {
  it("sets approvedAt, logs the tap, enqueues the pre-scan", async () => {
    const { application } = await makeApplication();
    const w = makeWorld();
    const out = await handleCallback(w.deps, CALLBACK.apply(application.id));
    expect(out.clearButtons).toBe(true);
    const saved = await prisma.application.findUniqueOrThrow({ where: { id: application.id } });
    expect(saved.approvedAt).toBeInstanceOf(Date);
    expect(w.enqueued).toEqual([{ name: "apply.prescan", data: { applicationId: application.id }, opts: { singletonKey: `prescan:${application.id}` } }]);
    expect(await actions()).toEqual(["telegram.tap", "application.approved"]);
  });

  it("a second tap is a no-op (one enqueue, one approvedAt)", async () => {
    const { application } = await makeApplication();
    const w = makeWorld();
    await handleCallback(w.deps, CALLBACK.apply(application.id));
    const first = (await prisma.application.findUniqueOrThrow({ where: { id: application.id } })).approvedAt;
    const again = await Promise.all([handleCallback(w.deps, CALLBACK.apply(application.id)), handleCallback(w.deps, CALLBACK.apply(application.id))]);
    expect(again.every((o) => o.toast === "Already handled")).toBe(true);
    expect(w.enqueued).toHaveLength(1);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: application.id } })).approvedAt).toEqual(first);
    expect(await actions("application.approved")).toHaveLength(1);
  });

  it("does nothing when the application is not pending approval", async () => {
    const { application } = await makeApplication({ status: "skipped" });
    const w = makeWorld();
    await handleCallback(w.deps, CALLBACK.apply(application.id));
    expect(w.enqueued).toHaveLength(0);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: application.id } })).approvedAt).toBeNull();
  });
});

describe("[Skip] / [Cancel]", () => {
  it("skip updates the status and logs it", async () => {
    const { application } = await makeApplication();
    const w = makeWorld();
    await handleCallback(w.deps, CALLBACK.skip(application.id));
    expect((await prisma.application.findUniqueOrThrow({ where: { id: application.id } })).status).toBe("skipped");
    expect(await actions()).toEqual(["telegram.tap", "application.skipped"]);
    expect((await handleCallback(w.deps, CALLBACK.skip(application.id))).toast).toBe("Already skipped");
  });

  it("cancel after the submit lock is refused", async () => {
    const { application } = await makeApplication({ status: "approved" });
    await prisma.application.update({ where: { id: application.id }, data: { submitLockedAt: new Date() } });
    const w = makeWorld();
    const out = await handleCallback(w.deps, CALLBACK.cancel(application.id));
    expect(out.toast).toMatch(/too late/i);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: application.id } })).status).toBe("approved");
  });

  it("cancel before the lock marks it skipped", async () => {
    const { application } = await makeApplication({ status: "approved" });
    const w = makeWorld();
    await handleCallback(w.deps, CALLBACK.cancel(application.id));
    expect((await prisma.application.findUniqueOrThrow({ where: { id: application.id } })).status).toBe("skipped");
  });
});

describe("[Submit]", () => {
  async function readyToSubmit() {
    const { application } = await makeApplication({ status: "approved" });
    await prisma.application.update({ where: { id: application.id }, data: { approvedAt: new Date(), filledAt: new Date() } });
    return application;
  }

  it("records submitApprovedAt once and enqueues the fill", async () => {
    const application = await readyToSubmit();
    const w = makeWorld();
    await handleCallback(w.deps, CALLBACK.submit(application.id));
    await handleCallback(w.deps, CALLBACK.submit(application.id));
    expect(w.enqueued.filter((e) => e.name === "apply.fill")).toHaveLength(1);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: application.id } })).submitApprovedAt).toBeInstanceOf(Date);
    expect(await actions("apply.submit_approved")).toHaveLength(1);
  });

  it("is refused if the form was never filled", async () => {
    const { application } = await makeApplication({ status: "approved" });
    await prisma.application.update({ where: { id: application.id }, data: { approvedAt: new Date() } });
    const w = makeWorld();
    await handleCallback(w.deps, CALLBACK.submit(application.id));
    expect(w.enqueued).toHaveLength(0);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: application.id } })).submitApprovedAt).toBeNull();
  });
});

describe("[View resume]", () => {
  it("tailors and renders when missing, then sends the PDF", async () => {
    await linkChat();
    const { application, job } = await makeApplication();
    const w = makeWorld();
    await handleCallback(w.deps, CALLBACK.viewResume(application.id));
    expect(w.tailorCalls).toEqual([job.id]);
    expect(w.renderCalls).toHaveLength(1);
    expect(w.sent.filter((s) => s.kind === "document")).toHaveLength(1);
  });

  it("reuses an existing version and PDF", async () => {
    await linkChat();
    const { application, job } = await makeApplication();
    const v = await prisma.resumeVersion.create({ data: { jobId: job.id, tailored: {}, pdfPath: "package.json" } });
    await prisma.application.update({ where: { id: application.id }, data: { resumeVersionId: v.id } });
    const w = makeWorld();
    await handleCallback(w.deps, CALLBACK.viewResume(application.id));
    expect(w.tailorCalls).toHaveLength(0);
    expect(w.renderCalls).toHaveLength(0);
    expect(w.sent.filter((s) => s.kind === "document")).toHaveLength(1);
  });

  it("says 'daily tailor cap reached' on TailorCapError and sends nothing else", async () => {
    await linkChat();
    const { application } = await makeApplication();
    const w = makeWorld({
      tailorForJob: async () => {
        throw new TailorCapError("Daily tailor cap reached (20)");
      },
    });
    const out = await handleCallback(w.deps, CALLBACK.viewResume(application.id));
    expect(out.toast).toBe("Daily tailor cap reached");
    expect(w.sent.map((s) => s.text).join("\n").toLowerCase()).toContain("daily tailor cap reached");
    expect(w.sent.some((s) => s.kind === "document")).toBe(false);
  });
});

describe("answering questions on Telegram", () => {
  async function setup() {
    await linkChat();
    const { application } = await makeApplication({ status: "needs_answers" });
    const w = makeWorld({ polish: fakePolish((r) => `${r.trim()}.`) });
    return { application, w };
  }

  it("asking a question saves the message with its questionId and marks it asked", async () => {
    const { application, w } = await setup();
    const q = await makeQuestion(application.id, { text: "Why Acme?" });
    await askQuestionWith(w.deps.client, q.id);
    expect(w.sent[0].text).toContain("Why Acme?");
    expect(w.sent[0].text).toContain("Backend Engineer at Acme");
    const saved = await prisma.question.findUniqueOrThrow({ where: { id: q.id } });
    expect(saved).toMatchObject({ status: "asked", askedVia: "telegram" });
    expect((await prisma.telegramMessage.findFirstOrThrow({ where: { questionId: q.id } })).chatMessageId).toBe(w.sent[0].messageId);
    expect(await actions("question.asked")).toHaveLength(1);
  });

  it("a swipe-reply goes to the question it replies to, not the oldest", async () => {
    const { application, w } = await setup();
    const q1 = await makeQuestion(application.id, { text: "First?" });
    const q2 = await makeQuestion(application.id, { text: "Second?" });
    await askQuestionWith(w.deps.client, q1.id);
    await askQuestionWith(w.deps.client, q2.id);
    const secondMsgId = w.sent[1].messageId;
    await handleText(w.deps, "because I like it", secondMsgId);
    expect((await prisma.question.findUniqueOrThrow({ where: { id: q2.id } })).answerId).not.toBeNull();
    expect((await prisma.question.findUniqueOrThrow({ where: { id: q1.id } })).answerId).toBeNull();
  });

  it("a plain message answers the oldest asked question", async () => {
    const { application, w } = await setup();
    const q1 = await makeQuestion(application.id, { text: "First?" });
    const q2 = await makeQuestion(application.id, { text: "Second?" });
    await askQuestionWith(w.deps.client, q1.id);
    await askQuestionWith(w.deps.client, q2.id);
    await handleText(w.deps, "plain reply");
    expect((await prisma.question.findUniqueOrThrow({ where: { id: q1.id } })).answerId).not.toBeNull();
    // the draft card offers [Use] [Edit] [Use my original]
    const card = w.sent.at(-1)!;
    expect(card.text).toContain("Polished:\nplain reply.");
    expect(card.buttons?.[0].map((b) => b.data)).toEqual([CALLBACK.useAnswer(q1.id), CALLBACK.editAnswer(q1.id), CALLBACK.useOriginal(q1.id)]);
  });

  it("when the polish is discarded, only [Edit] and [Use my original] are offered", async () => {
    await linkChat();
    const { application } = await makeApplication({ status: "needs_answers" });
    const w = makeWorld({ polish: fakePolish("I earn 50 LPA at Google") });
    const q = await makeQuestion(application.id);
    await askQuestionWith(w.deps.client, q.id);
    await handleText(w.deps, "i like backend work");
    const card = w.sent.at(-1)!;
    expect(card.text).not.toContain("Google");
    expect(card.buttons?.[0].map((b) => b.data)).toEqual([CALLBACK.editAnswer(q.id), CALLBACK.useOriginal(q.id)]);
  });

  it("[Use] then 'Yes' approves, reuses it, and the last required answer queues the fill", async () => {
    const { application, w } = await setup();
    const q = await makeQuestion(application.id, { text: "Why Acme?" });
    await askQuestionWith(w.deps.client, q.id);
    await handleText(w.deps, "I like the product");
    await handleCallback(w.deps, CALLBACK.useAnswer(q.id));
    expect(w.sent.at(-1)!.text).toContain("future jobs");
    await handleCallback(w.deps, `ans_save:${q.id}:p:y`);
    const answer = await prisma.answer.findFirstOrThrow({ where: { approved: true } });
    expect(answer).toMatchObject({ rawAnswer: "I like the product", polishedAnswer: "I like the product.", reusable: true });
    expect((await prisma.question.findUniqueOrThrow({ where: { id: q.id } })).status).toBe("answered");
    expect((await prisma.application.findUniqueOrThrow({ where: { id: application.id } })).status).toBe("approved");
    expect(w.enqueued.map((e) => e.name)).toEqual(["apply.fill"]);
    expect(await actions("answer.approved")).toHaveLength(1);
  });

  it("[Use my original] + 'Only this job' saves the raw text, not reusable", async () => {
    const { application, w } = await setup();
    const q = await makeQuestion(application.id);
    await askQuestionWith(w.deps.client, q.id);
    await handleText(w.deps, "my words");
    await handleCallback(w.deps, CALLBACK.useOriginal(q.id));
    await handleCallback(w.deps, `ans_save:${q.id}:o:n`);
    const answer = await prisma.answer.findFirstOrThrow({ where: { approved: true } });
    expect(answer).toMatchObject({ rawAnswer: "my words", polishedAnswer: null, reusable: false });
  });

  it("[Edit]: the next reply is saved exactly as written", async () => {
    const { application, w } = await setup();
    const q = await makeQuestion(application.id);
    await askQuestionWith(w.deps.client, q.id);
    await handleText(w.deps, "rough");
    await handleCallback(w.deps, CALLBACK.editAnswer(q.id));
    expect(w.sent.at(-1)!.text).toContain("Send the edited version");
    await handleText(w.deps, "Exactly   this text, as I typed it");
    await handleCallback(w.deps, `ans_save:${q.id}:p:n`);
    const answer = await prisma.answer.findFirstOrThrow({ where: { approved: true } });
    expect(answer.polishedAnswer).toBe("Exactly   this text, as I typed it");
    expect(answer.rawAnswer).toBe("rough");
  });

  it("a select question only accepts one of its options", async () => {
    const { application, w } = await setup();
    const q = await makeQuestion(application.id, { text: "Require sponsorship?", fieldType: "select", options: ["Yes", "No"] });
    await askQuestionWith(w.deps.client, q.id);
    await handleText(w.deps, "maybe later");
    expect(w.sent.at(-1)!.text).toContain("Yes / No");
    expect((await prisma.question.findUniqueOrThrow({ where: { id: q.id } })).answerId).toBeNull();
    await handleText(w.deps, "no");
    expect(w.sent.at(-1)!.text).toContain("Polished:\nNo");
  });

  it("a stray message with nothing waiting gets a hint, not a crash", async () => {
    await linkChat();
    const w = makeWorld();
    await handleText(w.deps, "hello?");
    expect(w.sent.at(-1)!.text).toContain("Nothing is waiting");
  });
});

describe("commands", () => {
  it("/status shows today's counts, dry run and cap", async () => {
    const { application } = await makeApplication({ status: "applied" });
    await prisma.application.update({ where: { id: application.id }, data: { appliedAt: new Date() } });
    await makeApplication({ status: "pending_approval" });
    const text = await handleCommand(makeWorld().deps, "status", "");
    expect(text).toContain("1/15 applied");
    expect(text).toContain("1 to approve");
    expect(text).toContain("DRY RUN");
  });

  it("/pending lists approvals and waiting questions", async () => {
    const { application } = await makeApplication({ status: "pending_approval" });
    const { application: a2 } = await makeApplication({ status: "needs_answers", jobData: { company: "Beta" } });
    await makeQuestion(a2.id, { text: "Notice period?", status: "asked" });
    const text = await handleCommand(makeWorld().deps, "pending", "");
    expect(text).toContain(`#${application.id}`);
    expect(text).toContain("Beta: Notice period?");
  });

  it("/pause and /resume work on all loops or one by name, and re-sync schedules", async () => {
    await prisma.loop.createMany({
      data: [
        { name: "Backend", keywords: ["sde"], locations: [], sources: [] },
        { name: "Frontend", keywords: ["react"], locations: [], sources: [] },
      ],
    });
    let synced = 0;
    const w = makeWorld({ syncLoopSchedules: async () => void synced++ });
    expect(await handleCommand(w.deps, "pause", "frontend")).toBe("Paused: Frontend");
    expect((await prisma.loop.findMany({ orderBy: { id: "asc" } })).map((l) => l.active)).toEqual([true, false]);
    await handleCommand(w.deps, "pause", "");
    expect((await prisma.loop.findMany()).every((l) => !l.active)).toBe(true);
    await handleCommand(w.deps, "resume", "");
    expect((await prisma.loop.findMany()).every((l) => l.active)).toBe(true);
    expect(synced).toBe(3);
    expect(await actions("loop.paused")).toHaveLength(3);
    expect(await handleCommand(w.deps, "pause", "nope")).toContain("No loop named");
  });
});
