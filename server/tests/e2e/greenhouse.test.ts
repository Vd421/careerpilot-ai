import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createFormFiller } from "../../src/apply/filler.js";
import { fillApplication } from "../../src/apply/fill.js";
import { startApplication } from "../../src/apply/start.js";
import type { ApplyDeps } from "../../src/apply/types.js";
import { CALLBACK } from "../../src/contracts.js";
import { prisma } from "../../src/db.js";
import { sendJobCardWith } from "../../src/telegram/card.js";
import { handleCallback, handleText } from "../../src/telegram/handlers.js";
import { askQuestionWith } from "../../src/telegram/questions.js";
import { resetDb } from "../helpers/resetDb.js";
import { exampleResume } from "../apply/support.js";
import { fakePolish, linkChat, makeApplication, makeWorld, modelResult } from "../telegram/support.js";

// The whole Greenhouse path on a saved real form (file://), real Chromium, real test DB.
// Claude and Telegram are fakes. Nothing is ever submitted (the filler is built with allowSubmit=false).
// Skip with SKIP_BROWSER_TESTS=1.
const skip = process.env.SKIP_BROWSER_TESTS === "1";
const FORM = pathToFileURL(resolve(import.meta.dirname, "../fixtures/forms/greenhouse-interactive.html")).href;

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const bank = (key: string, patterns: string[], answer: string) =>
  prisma.answer.create({ data: { key, questionText: patterns[0], patterns, rawAnswer: answer, approved: true, reusable: true } });

describe.skipIf(skip)("e2e: Greenhouse, pre-scan to filled form (dry run)", () => {
  it("job -> [Apply] -> pre-scan -> bank answers -> 1 question on Telegram -> polish -> approve -> fill -> screenshot, nothing submitted", async () => {
    await linkChat();
    await prisma.settings.update({ where: { id: 1 }, data: { dryRun: true } });

    // --- a scored job, an application, and the saved form as its apply link
    const { job, application } = await makeApplication({ jobData: { url: FORM, company: "Groww", title: "Assistant Manager" } });
    const dir = mkdtempSync(join(tmpdir(), "e2e-"));
    const pdf = join(dir, "resume.pdf");
    writeFileSync(pdf, "%PDF-fake");
    const version = await prisma.resumeVersion.create({ data: { jobId: job.id, tailored: {}, pdfPath: pdf } });
    await prisma.application.update({ where: { id: application.id }, data: { resumeVersionId: version.id } });

    // --- my reusable answers (the answer bank)
    await bank("current_location", ["location city"], "Bengaluru, India");
    await bank("relative", ["relative family member working"], "No");
    await bank("prev_employed", ["previously been employed by"], "No");
    await bank("bg_check", ["consent for us to conduct your background verification"], "Yes");

    // --- fakes: Telegram wire, Claude (polish + classifier), queue
    const world = makeWorld({ polish: fakePolish((raw) => `${raw.trim().replace(/^i /, "I ")}.`) });
    const filler = createFormFiller({ allowSubmit: false, formWaitMs: 1500 });
    const deps: ApplyDeps = {
      filler,
      telegram: world.deps.client,
      askQuestion: (id) => askQuestionWith(world.deps.client, id),
      tailorForJob: world.deps.tailorForJob,
      renderResumePdf: world.deps.renderResumePdf,
      enqueue: world.deps.enqueue,
      loadResume: () => ({ ...exampleResume, basics: { ...exampleResume.basics, phone: "+91 90000 00000" } }),
      classifier: async () => modelResult({ key: "none" }),
      screenshotsDir: join(dir, "screenshots"),
    };

    // --- card + [Apply]
    await sendJobCardWith(world.deps.client, application.id);
    await handleCallback(world.deps, CALLBACK.apply(application.id));
    expect(world.enqueued.map((e) => e.name)).toEqual(["apply.prescan"]);

    // --- pre-scan: 4 questions answered from the bank, 1 unknown asked on Telegram
    await startApplication(application.id, deps);
    expect(await prisma.application.findUniqueOrThrow({ where: { id: application.id } })).toMatchObject({ status: "needs_answers" });
    const questions = await prisma.question.findMany({ where: { applicationId: application.id }, orderBy: { id: "asc" } });
    expect(questions.filter((q) => q.askedVia === "bank")).toHaveLength(4);
    const asked = questions.filter((q) => q.status === "asked");
    expect(asked).toHaveLength(1);
    expect(asked[0].text).toBe("Why do you want to work at Groww?");
    const askedMessage = world.sent.find((s) => s.text.includes("Why do you want to work at Groww?"))!;

    // --- my reply (swipe-reply to the question) -> polish -> [Use] -> "only this job" -> approved
    await handleText(world.deps, "i like how groww makes investing simple", askedMessage.messageId);
    const card = world.sent.at(-1)!;
    expect(card.text).toContain("Polished:\nI like how groww makes investing simple.");
    await handleCallback(world.deps, CALLBACK.useAnswer(asked[0].id));
    await handleCallback(world.deps, `ans_save:${asked[0].id}:p:n`);
    expect(await prisma.application.findUniqueOrThrow({ where: { id: application.id } })).toMatchObject({ status: "approved" });
    expect(world.enqueued.map((e) => e.name)).toEqual(["apply.prescan", "apply.fill"]);

    // --- fill (dry run): screenshot exists, nothing submitted
    await fillApplication(application.id, deps);
    const done = await prisma.application.findUniqueOrThrow({ where: { id: application.id } });
    expect(done.status).toBe("approved");
    expect(done.appliedAt).toBeNull();
    expect(done.submitLockedAt).toBeNull();
    expect(done.filledAt).toBeInstanceOf(Date);
    expect(done.screenshotPath).toMatch(/\.png$/);
    expect(existsSync(resolve(done.screenshotPath!))).toBe(true);

    const photo = world.sent.find((s) => s.kind === "photo")!;
    expect(photo.text).toContain("Dry run: filled, not submitted");

    // --- the activity log tells the story, in order
    const types = (await prisma.agentAction.findMany({ orderBy: { id: "asc" } })).map((a) => a.type);
    expect(types).toEqual([
      "telegram.card_sent",
      "telegram.tap",
      "application.approved",
      "form.prescanned",
      "question.matched_bank",
      "question.matched_bank",
      "question.matched_bank",
      "question.matched_bank",
      "question.asked",
      "question.answered",
      "answer.polished",
      "answer.approved",
      "apply.filled",
      "apply.dry_run",
    ]);
    expect(types).not.toContain("apply.submitted");
  }, 90_000); // real Chromium, three page loads
});
