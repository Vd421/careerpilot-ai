import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resolve } from "node:path";
import { prisma } from "../../src/db.js";
import { resetDb } from "../helpers/resetDb.js";
import { runTailor, TailorError, type TailorModel } from "../../src/tailor/index.js";
import { validateTailored } from "../../src/tailor/validate.js";
import { buildTailorPrompt } from "../../src/tailor/prompt.js";
import { loadResume } from "../../src/resume/load.js";
import type { ModelResult } from "../../src/ai/client.js";

const examplePath = resolve(import.meta.dirname, "../../../data/resume.example.json");
const resume = loadResume(examplePath);

const GOOD = {
  headline: "Software engineer building Node.js and PostgreSQL services",
  sections: [
    {
      sourceId: "acme",
      bullets: [
        { sourceBulletId: "acme-2", text: "Raised test coverage from 40% to 75% by writing Vitest integration tests" },
        { sourceBulletId: "acme-1", text: "Built REST APIs in Node.js and PostgreSQL for an internal billing tool" },
      ],
    },
  ],
  skillsOrder: ["postgresql", "TypeScript"],
  coverNote: null,
};

function withBullet(sourceId: string, sourceBulletId: string, text: string) {
  return { ...GOOD, sections: [{ sourceId, bullets: [{ sourceBulletId, text }] }] };
}

// Fake Claude: returns the given outputs one per call, and records prompts.
function fakeModel(...outputs: unknown[]) {
  const prompts: string[] = [];
  let i = 0;
  const model: TailorModel = async (_system, user) => {
    prompts.push(user);
    const result: ModelResult = {
      output: outputs[Math.min(i++, outputs.length - 1)],
      model: "fake-model",
      inputTokens: 2000,
      outputTokens: 500,
      stopReason: "end_turn",
    };
    return result;
  };
  return { model, prompts };
}

async function setup() {
  await prisma.settings.create({ data: { id: 1 } });
  const variant = await prisma.resumeVariant.create({ data: { name: "A", filePath: examplePath } });
  const job = await prisma.job.create({
    data: { company: "Acme", title: "Backend Engineer", description: "Node, Postgres", matchedSkills: ["PostgreSQL"], missingSkills: ["Kafka"] },
  });
  return { variant, job };
}

describe("validateTailored", () => {
  it("accepts a faithful rewrite", () => {
    expect(validateTailored(GOOD, resume)).toEqual([]);
  });
  it("rejects an unknown bullet id", () => {
    expect(validateTailored(withBullet("acme", "acme-99", "Did stuff"), resume)[0]).toMatch(/acme-99/);
  });
  it("rejects a bullet under the wrong section", () => {
    expect(validateTailored(withBullet("todo", "acme-1", "Built APIs"), resume)[0]).toMatch(/does not exist under "todo"/);
  });
  it("rejects an unknown section", () => {
    expect(validateTailored(withBullet("nope", "acme-1", "x"), resume)[0]).toMatch(/nope/);
  });
  it("rejects a reused bullet id", () => {
    const t = {
      ...GOOD,
      sections: [{ sourceId: "acme", bullets: [GOOD.sections[0].bullets[1], GOOD.sections[0].bullets[1]] }],
    };
    expect(validateTailored(t, resume).join()).toMatch(/more than once/);
  });
  it("rejects a changed number", () => {
    const v = validateTailored(withBullet("acme", "acme-2", "Raised coverage from 40% to 90%"), resume);
    expect(v.join()).toMatch(/"90%"/);
  });
  it("rejects a number moved off its unit (40% vs 40)", () => {
    expect(validateTailored(withBullet("acme", "acme-2", "Raised coverage from 40 to 75%"), resume)).not.toEqual([]);
  });
  it("rejects a number added to a bullet that had none", () => {
    expect(validateTailored(withBullet("todo", "todo-1", "Built a todo app used by 500 people"), resume)).not.toEqual([]);
  });
  it("rejects a skill that is not in the resume", () => {
    expect(validateTailored({ ...GOOD, skillsOrder: ["Kafka"] }, resume)[0]).toMatch(/Kafka/);
  });
  it("rejects invented numbers in the headline", () => {
    expect(validateTailored({ ...GOOD, headline: "10 years of experience" }, resume)[0]).toMatch(/headline/);
  });
});

describe("buildTailorPrompt", () => {
  it("does not send contact details but lists violations on retry", () => {
    const p = buildTailorPrompt({ company: "A", title: "B", description: "JD" }, resume, [], [], ["bad id"]);
    expect(p).not.toContain(resume.basics.email);
    expect(p).not.toContain(resume.basics.name);
    expect(p).toContain("bad id");
    expect(p).toContain("acme-1");
  });
});

describe("runTailor", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("(a) saves a valid version, logs the AiCall and the action", async () => {
    const { job, variant } = await setup();
    const { resumeVersionId } = await runTailor(job.id, undefined, fakeModel(GOOD).model);

    const v = await prisma.resumeVersion.findUniqueOrThrow({ where: { id: resumeVersionId } });
    expect(v).toMatchObject({ jobId: job.id, variantId: variant.id });
    expect(v.tailored).toEqual(GOOD);
    expect(await prisma.aiCall.findMany()).toMatchObject([{ purpose: "tailor", jobId: job.id, inputTokens: 2000 }]);
    expect((await prisma.agentAction.findMany()).map((a) => a.type)).toEqual(["resume.tailored"]);
  });

  it("(b) invented bullet id: retried once, then TailorError, nothing saved", async () => {
    const { job } = await setup();
    const fake = fakeModel(withBullet("acme", "acme-99", "Led a team of engineers"));
    await expect(runTailor(job.id, undefined, fake.model)).rejects.toThrow(TailorError);

    expect(fake.prompts).toHaveLength(2);
    expect(await prisma.resumeVersion.count()).toBe(0);
    expect(await prisma.aiCall.count()).toBe(2); // both calls cost money, both logged
    const rejected = await prisma.agentAction.findMany({ where: { type: "resume.tailor_rejected" } });
    expect(rejected).toHaveLength(2);
    expect(JSON.stringify(rejected[0].detail)).toContain("acme-99");
  });

  it("(c) changed number 40% -> 60% is rejected", async () => {
    const { job } = await setup();
    const bad = withBullet("acme", "acme-2", "Raised coverage from 60% to 75%");
    await expect(runTailor(job.id, undefined, fakeModel(bad).model)).rejects.toThrow(/60%/);
    expect(await prisma.resumeVersion.count()).toBe(0);
  });

  it("(d) unknown skill is rejected", async () => {
    const { job } = await setup();
    await expect(runTailor(job.id, undefined, fakeModel({ ...GOOD, skillsOrder: ["Rust"] }).model)).rejects.toThrow(/Rust/);
    expect(await prisma.resumeVersion.count()).toBe(0);
  });

  it("(e) bad then good: the retry prompt carries the violations and the good one is saved", async () => {
    const { job } = await setup();
    const bad = withBullet("acme", "acme-2", "Raised coverage from 40% to 99%");
    const fake = fakeModel(bad, GOOD);
    const { resumeVersionId } = await runTailor(job.id, undefined, fake.model);

    expect(fake.prompts[0]).not.toContain("previous_attempt_rejected");
    expect(fake.prompts[1]).toContain("99%");
    expect(await prisma.resumeVersion.count()).toBe(1);
    expect((await prisma.resumeVersion.findUniqueOrThrow({ where: { id: resumeVersionId } })).tailored).toEqual(GOOD);
    expect(await prisma.aiCall.count()).toBe(2);
    expect(await prisma.agentAction.count({ where: { type: "resume.tailor_rejected" } })).toBe(1);
  });

  it("a schema-invalid answer (null) is rejected too", async () => {
    const { job } = await setup();
    await expect(runTailor(job.id, undefined, fakeModel(null).model)).rejects.toThrow(TailorError);
    expect(await prisma.resumeVersion.count()).toBe(0);
  });

  it("respects maxTailorsPerDay", async () => {
    const { job } = await setup();
    await prisma.settings.update({ where: { id: 1 }, data: { maxTailorsPerDay: 1 } });
    await prisma.aiCall.create({ data: { purpose: "tailor", model: "m", inputTokens: 1, outputTokens: 1 } });
    const fake = fakeModel(GOOD);
    await expect(runTailor(job.id, undefined, fake.model)).rejects.toThrow(/cap/);
    expect(fake.prompts).toHaveLength(0);
  });

  it("uses the application's A/B variant and links the new version to it", async () => {
    const { job } = await setup();
    const b = await prisma.resumeVariant.create({ data: { name: "B", filePath: examplePath } });
    const app = await prisma.application.create({
      data: { jobId: job.id, idempotencyKey: `apply:${job.id}`, resumeVariantId: b.id },
    });
    const { resumeVersionId } = await runTailor(job.id, undefined, fakeModel(GOOD).model);
    expect((await prisma.resumeVersion.findUniqueOrThrow({ where: { id: resumeVersionId } })).variantId).toBe(b.id);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: app.id } })).resumeVersionId).toBe(resumeVersionId);
  });

  it("fails clearly when no variant is seeded", async () => {
    const job = await prisma.job.create({ data: { company: "A", title: "B", description: "C" } });
    await expect(runTailor(job.id, undefined, fakeModel(GOOD).model)).rejects.toThrow(/db:seed/);
  });
});
