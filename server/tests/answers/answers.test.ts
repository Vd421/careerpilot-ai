import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../../src/db.js";
import {
  containsPhrase,
  findNewFacts,
  makeApproveAnswer,
  makeSubmitRawAnswer,
  mapToOption,
  matchAnswer,
  normalizeQuestion,
  seedAnswers,
  type ClassifierModel,
} from "../../src/answers/index.js";
import { resetDb } from "../helpers/resetDb.js";
import { fakePolish, makeApplication, makeQuestion, modelResult } from "../telegram/support.js";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

function tmpJson(obj: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "answers-"));
  const p = join(dir, "answers.json");
  writeFileSync(p, JSON.stringify(obj));
  return p;
}

async function bank(key: string, patterns: string[], answer: string, extra: Partial<{ approved: boolean; reusable: boolean }> = {}) {
  return prisma.answer.create({
    data: {
      key,
      questionText: normalizeQuestion(patterns[0]),
      patterns: patterns.map(normalizeQuestion),
      rawAnswer: answer,
      approved: extra.approved ?? true,
      reusable: extra.reusable ?? true,
    },
  });
}

describe("normalizeQuestion / mapToOption", () => {
  it("lowercases and strips punctuation, asterisks and '(required)'", () => {
    expect(normalizeQuestion("  Notice   Period? * ")).toBe("notice period");
    expect(normalizeQuestion("Expected CTC (required)")).toBe("expected ctc");
    expect(normalizeQuestion("Do you know C++ / C#?")).toBe("do you know c++ c#");
    expect(normalizeQuestion("LinkedIn Profile✱")).toBe("linkedin profile");
  });

  it("matches phrases on word boundaries only", () => {
    expect(containsPhrase("what is your current city", "city")).toBe(true);
    expect(containsPhrase("your current capacity", "city")).toBe(false);
  });

  it("maps a value onto an option: exact, case-insensitive, prefix", () => {
    const opts = ["Yes", "No", "Prefer not to say"];
    expect(mapToOption("yes", opts)).toBe("Yes");
    expect(mapToOption("Yes, I am", opts)).toBe("Yes");
    expect(mapToOption("prefer", opts)).toBe("Prefer not to say");
    expect(mapToOption("maybe", opts)).toBeNull();
    expect(mapToOption("", opts)).toBeNull();
  });
});

describe("seedAnswers", () => {
  it("upserts by key as approved + reusable, skips empty answers", async () => {
    const path = tmpJson({
      answers: [
        { key: "notice_period", patterns: ["Notice period?", "When can you start"], answer: "60 days", reusable: true },
        { key: "expected_ctc", patterns: ["expected ctc"], answer: "" },
        { key: "github", patterns: ["github"], answer: "   " },
      ],
    });
    expect(await seedAnswers(path)).toEqual({ seeded: 1, skipped: 2 });
    const rows = await prisma.answer.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "notice_period", approved: true, reusable: true, rawAnswer: "60 days" });
    expect(rows[0].patterns).toContain("notice period");
    expect(rows[0].patterns).toContain("when can you start");

    // re-running updates instead of duplicating
    const path2 = tmpJson({ answers: [{ key: "notice_period", patterns: ["notice period"], answer: "45 days" }] });
    await seedAnswers(path2);
    expect(await prisma.answer.count()).toBe(1);
    expect((await prisma.answer.findFirstOrThrow()).rawAnswer).toBe("45 days");
  });

  it("a missing file is a warning, not a crash", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await seedAnswers(join(tmpdir(), "does-not-exist.json"))).toEqual({ seeded: 0, skipped: 0 });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("matchAnswer", () => {
  it("matches an exact normalized question", async () => {
    await bank("notice_period", ["Notice period"], "60 days");
    const m = await matchAnswer("Notice Period? *", "text");
    expect(m).toMatchObject({ value: "60 days", via: "exact" });
  });

  it("matches by pattern containment, longest pattern wins", async () => {
    await bank("a", ["city"], "Bengaluru");
    await bank("b", ["current city of residence"], "Pune");
    const m = await matchAnswer("What is your current city of residence?", "text");
    expect(m?.value).toBe("Pune");
    expect(m?.via).toBe("pattern");
  });

  it("does not match inside another word ('capacity' vs 'city')", async () => {
    await bank("city", ["city"], "Bengaluru");
    expect(await matchAnswer("Have you worked here in any capacity?", "text", [], { classifier: async () => modelResult({ key: "none" }) })).toBeNull();
  });

  it("ignores unapproved and job-specific (non-reusable) answers", async () => {
    await bank("draft", ["notice period"], "60 days", { approved: false });
    await bank("one_off", ["why this company"], "Because X", { reusable: false });
    const classifier: ClassifierModel = async () => modelResult({ key: "none" });
    expect(await matchAnswer("Notice period", "text", [], { classifier })).toBeNull();
    expect(await matchAnswer("Why this company?", "text", [], { classifier })).toBeNull();
  });

  it("select/radio: the answer must map onto an option, else unmatched", async () => {
    await bank("sponsorship", ["require sponsorship"], "No");
    expect((await matchAnswer("Do you require sponsorship?", "select", ["Yes", "No"]))?.value).toBe("No");
    expect(await matchAnswer("Do you require sponsorship?", "radio", ["Yes, now", "Yes, later"], { classifier: async () => modelResult({ key: "none" }) })).toBeNull();
    // free text keeps the saved wording
    expect((await matchAnswer("Do you require sponsorship?", "text"))?.value).toBe("No");
  });

  it("classifier sees keys and question texts only, never the answers", async () => {
    await bank("expected_ctc", ["expected ctc"], "TOP-SECRET-24-LPA");
    let prompt = "";
    const classifier: ClassifierModel = async (_s, user) => {
      prompt = user;
      return modelResult({ key: "expected_ctc" });
    };
    const m = await matchAnswer("What salary are you looking for?", "text", [], { classifier });
    expect(m).toMatchObject({ value: "TOP-SECRET-24-LPA", via: "classifier" });
    expect(prompt).toContain("expected_ctc");
    expect(prompt).not.toContain("TOP-SECRET");
    expect(await prisma.aiCall.count({ where: { purpose: "match_question" } })).toBe(1);
  });

  it("classifier returning an unknown key (or 'none', or junk) means unmatched", async () => {
    await bank("expected_ctc", ["expected ctc"], "24 LPA");
    for (const out of [{ key: "made_up_key" }, { key: "none" }, { nope: 1 }, null]) {
      expect(await matchAnswer("What salary are you looking for?", "text", [], { classifier: async () => modelResult(out) })).toBeNull();
    }
  });

  it("with an empty bank it never calls the classifier", async () => {
    const classifier = vi.fn();
    expect(await matchAnswer("Anything?", "text", [], { classifier })).toBeNull();
    expect(classifier).not.toHaveBeenCalled();
  });
});

describe("findNewFacts (the 'no new facts' check)", () => {
  it("accepts pure grammar/tone changes", () => {
    expect(findNewFacts("i have 3 yrs exp in node and react", "I have 3 years of experience in Node and React.")).toEqual([]);
    expect(findNewFacts("my notice is 60 days", "My notice period is 60 days.")).toEqual([]);
  });

  it("rejects a number that is not in the original", () => {
    expect(findNewFacts("i have 3 years exp", "I have 5 years of experience.")).toEqual(["number 5"]);
    expect(findNewFacts("about 60 days", "About 90 days.")).toEqual(["number 90"]);
  });

  it("treats 1,50,000 and 150000 as different, and keeps decimals exact", () => {
    expect(findNewFacts("ctc is 12.5 lpa", "My CTC is 12.5 LPA.")).toEqual([]);
    expect(findNewFacts("ctc is 12 lpa", "My CTC is 12.5 LPA.")).toEqual(["number 12.5"]);
  });

  it("rejects new URLs and emails", () => {
    expect(findNewFacts("see my github", "See my GitHub at https://github.com/x")).toContain("URL https://github.com/x");
    expect(findNewFacts("mail me", "Mail me at a@b.com")).toContain("email a@b.com");
    expect(findNewFacts("see https://x.dev/me", "See https://x.dev/me.")).toEqual([]);
  });

  it("rejects new proper nouns but allows re-capitalizing words already present", () => {
    expect(findNewFacts("i worked at google on search", "I worked at Google on search.")).toEqual([]);
    expect(findNewFacts("i worked on search", "I worked at Google on search.")).toEqual(["name Google"]);
    expect(findNewFacts("i know react", "I know React and Kubernetes.")).toEqual(["name Kubernetes"]);
  });
});

describe("submitRawAnswer", () => {
  async function setup(text = "Why Acme?", over: Parameters<typeof makeQuestion>[1] = {}) {
    const { application } = await makeApplication({ status: "needs_answers" });
    const q = await makeQuestion(application.id, { text, ...over });
    return { application, q };
  }

  it("polishes, keeps both versions in an unapproved draft and logs the AI call", async () => {
    const { q } = await setup();
    const submit = makeSubmitRawAnswer({ polishModel: fakePolish("I like the product.") });
    expect(await submit(q.id, "i like the product")).toEqual({ polished: "I like the product." });
    const draft = await prisma.answer.findFirstOrThrow();
    expect(draft).toMatchObject({ approved: false, rawAnswer: "i like the product", polishedAnswer: "I like the product." });
    expect((await prisma.question.findUniqueOrThrow({ where: { id: q.id } })).answerId).toBe(draft.id);
    expect(await prisma.aiCall.count({ where: { purpose: "polish" } })).toBe(1);
  });

  it("a polish that adds a number is discarded: the original is offered", async () => {
    const { q } = await setup();
    const submit = makeSubmitRawAnswer({ polishModel: fakePolish("I have 7 years of experience.") });
    const res = await submit(q.id, "i have some experience");
    expect(res.polished).toBe("i have some experience");
    expect((await prisma.answer.findFirstOrThrow()).polishedAnswer).toBeNull();
    const logged = await prisma.agentAction.findFirstOrThrow({ where: { type: "answer.polished" } });
    expect(logged.detail).toMatchObject({ offered: false, rejectedBecause: ["number 7"] });
  });

  it("unusable model output (null) falls back to the original and still logs the cost", async () => {
    const { q } = await setup();
    const submit = makeSubmitRawAnswer({ polishModel: async () => modelResult(null) });
    expect((await submit(q.id, "my words")).polished).toBe("my words");
    expect(await prisma.aiCall.count({ where: { purpose: "polish" } })).toBe(1);
  });

  it("select fields skip polishing and must be an option", async () => {
    const { q } = await setup("Visa?", { fieldType: "select", options: ["Yes", "No"] });
    const polish = vi.fn();
    const submit = makeSubmitRawAnswer({ polishModel: polish });
    expect((await submit(q.id, "no")).polished).toBe("No");
    await expect(submit(q.id, "perhaps")).rejects.toThrow(/one of: Yes \/ No/);
    expect(polish).not.toHaveBeenCalled();
  });

  it("rejects an empty answer", async () => {
    const { q } = await setup();
    await expect(makeSubmitRawAnswer({ polishModel: fakePolish("x") })(q.id, "   ")).rejects.toThrow(/empty/);
  });

  it("answering again re-uses the same draft instead of piling up rows", async () => {
    const { q } = await setup();
    const submit = makeSubmitRawAnswer({ polishModel: fakePolish((r) => r) });
    await submit(q.id, "first");
    await submit(q.id, "second");
    expect(await prisma.answer.count()).toBe(1);
    expect((await prisma.answer.findFirstOrThrow()).rawAnswer).toBe("second");
  });
});

describe("approveAnswer", () => {
  function enqueueSpy() {
    const calls: { name: string; data: Record<string, unknown> }[] = [];
    return { calls, enqueue: async (name: string, data: Record<string, unknown>) => void calls.push({ name, data }) };
  }

  async function drafted(text = "Why Acme?", over: Parameters<typeof makeQuestion>[1] = {}) {
    const { application } = await makeApplication({ status: "needs_answers" });
    const q = await makeQuestion(application.id, { text, ...over });
    await makeSubmitRawAnswer({ polishModel: fakePolish("Polished text.") })(q.id, "rough text");
    return { application, q };
  }

  it("polished: approves the draft, links the question", async () => {
    const { q } = await drafted();
    const { enqueue } = enqueueSpy();
    await makeApproveAnswer({ enqueue })(q.id, "polished", true);
    const a = await prisma.answer.findFirstOrThrow();
    expect(a).toMatchObject({ approved: true, reusable: true, rawAnswer: "rough text", polishedAnswer: "Polished text.", questionText: "why acme" });
    expect(await prisma.question.findUniqueOrThrow({ where: { id: q.id } })).toMatchObject({ status: "answered", answerId: a.id });
  });

  it("original: stores my words as the final text", async () => {
    const { q } = await drafted();
    await makeApproveAnswer({ enqueue: enqueueSpy().enqueue })(q.id, "original", false);
    expect(await prisma.answer.findFirstOrThrow()).toMatchObject({ polishedAnswer: null, reusable: false, approved: true });
  });

  it("edited: my text is used as written", async () => {
    const { q } = await drafted();
    await makeApproveAnswer({ enqueue: enqueueSpy().enqueue })(q.id, { edited: "  Hand-written answer. " }, false);
    expect((await prisma.answer.findFirstOrThrow()).polishedAnswer).toBe("Hand-written answer.");
  });

  it("without a draft, 'polished' is an error but an edited answer works (dashboard path)", async () => {
    const { application } = await makeApplication({ status: "needs_answers" });
    const q = await makeQuestion(application.id, { text: "Notice?" });
    const approve = makeApproveAnswer({ enqueue: enqueueSpy().enqueue });
    await expect(approve(q.id, "polished", true)).rejects.toThrow(/No answer/);
    await approve(q.id, { edited: "60 days" }, true);
    expect(await prisma.answer.findFirstOrThrow()).toMatchObject({ approved: true, rawAnswer: "60 days" });
  });

  it("reusable: updates the existing bank row for the same question instead of duplicating", async () => {
    await bank("notice", ["why acme"], "old answer");
    const { q } = await drafted();
    await makeApproveAnswer({ enqueue: enqueueSpy().enqueue })(q.id, "polished", true);
    const rows = await prisma.answer.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "notice", polishedAnswer: "Polished text." });
    expect((await prisma.question.findUniqueOrThrow({ where: { id: q.id } })).answerId).toBe(rows[0].id);
  });

  it("select answers must be one of the options", async () => {
    const { application } = await makeApplication({ status: "needs_answers" });
    const q = await makeQuestion(application.id, { text: "Visa?", fieldType: "select", options: ["Yes", "No"] });
    const approve = makeApproveAnswer({ enqueue: enqueueSpy().enqueue });
    await expect(approve(q.id, { edited: "perhaps" }, true)).rejects.toThrow(/one of/);
    await approve(q.id, { edited: "yes" }, true);
    expect((await prisma.answer.findFirstOrThrow()).polishedAnswer).toBe("Yes");
  });

  it("the LAST required answer moves the application to approved and queues the fill once", async () => {
    const { application } = await makeApplication({ status: "needs_answers" });
    const q1 = await makeQuestion(application.id, { text: "One?" });
    const q2 = await makeQuestion(application.id, { text: "Two?" });
    await makeQuestion(application.id, { text: "Optional?", required: false });
    const { enqueue, calls } = enqueueSpy();
    const approve = makeApproveAnswer({ enqueue });
    await approve(q1.id, { edited: "a" }, false);
    expect(calls).toHaveLength(0);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: application.id } })).status).toBe("needs_answers");
    await approve(q2.id, { edited: "b" }, false);
    expect(calls).toEqual([{ name: "apply.fill", data: { applicationId: application.id } }]);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: application.id } })).status).toBe("approved");
  });
});
