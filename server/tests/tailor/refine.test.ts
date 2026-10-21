import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resolve } from "node:path";
import { prisma } from "../../src/db.js";
import { resetDb } from "../helpers/resetDb.js";
import { runRefine, TailorCapError, TailorError, type TailorModel } from "../../src/tailor/index.js";
import type { ModelResult } from "../../src/ai/client.js";
import type { TailoredResume } from "../../src/contracts.js";

const examplePath = resolve(import.meta.dirname, "../../../data/resume.example.json");

const BASE: TailoredResume = {
  headline: null,
  sections: [
    {
      sourceId: "acme",
      bullets: [
        { sourceBulletId: "acme-1", text: "Built REST APIs in Node.js and PostgreSQL for an internal billing tool" },
        { sourceBulletId: "acme-2", text: "Raised coverage from 40% to 75% with Vitest integration tests" },
      ],
    },
  ],
  skillsOrder: ["TypeScript", "PostgreSQL"],
  coverNote: null,
};

// "Lead with testing": same bullets, swapped, Postgres first in skills
const REORDERED: TailoredResume = {
  ...BASE,
  sections: [{ sourceId: "acme", bullets: [BASE.sections[0].bullets[1], BASE.sections[0].bullets[0]] }],
  skillsOrder: ["PostgreSQL", "TypeScript"],
};

const turn = (tailored: TailoredResume, changed = true, reply = "Moved the testing bullet first.") => ({ reply, changed, tailored });

function fakeModel(...outputs: unknown[]) {
  const prompts: string[] = [];
  let i = 0;
  const model: TailorModel = async (_system, user) => {
    prompts.push(user);
    const result: ModelResult = {
      output: outputs[Math.min(i++, outputs.length - 1)],
      model: "fake-model",
      inputTokens: 2500,
      outputTokens: 600,
      stopReason: "end_turn",
    };
    return result;
  };
  return { model, prompts };
}

async function setup() {
  await prisma.settings.create({ data: { id: 1 } });
  const variant = await prisma.resumeVariant.create({ data: { name: "A", filePath: examplePath } });
  const job = await prisma.job.create({ data: { company: "Acme", title: "Backend Engineer", description: "Node, Postgres, testing" } });
  const base = await prisma.resumeVersion.create({
    data: { jobId: job.id, variantId: variant.id, tailored: BASE as never },
  });
  return { job, base };
}

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("runRefine", () => {
  it("saves a new version linked to its parent and the instruction, and both chat messages", async () => {
    const { job, base } = await setup();
    const fake = fakeModel(turn(REORDERED));

    const out = await runRefine(job.id, "Lead with testing", base.id, fake.model);

    expect(out.resumeVersionId).not.toBeNull();
    const v = await prisma.resumeVersion.findUniqueOrThrow({ where: { id: out.resumeVersionId! } });
    expect(v).toMatchObject({ parentId: base.id, instruction: "Lead with testing" });
    expect((v.tailored as unknown as TailoredResume).sections[0].bullets[0].sourceBulletId).toBe("acme-2");

    const chat = await prisma.resumeChatMessage.findMany({ where: { jobId: job.id }, orderBy: { id: "asc" } });
    expect(chat.map((m) => [m.role, m.text])).toEqual([
      ["user", "Lead with testing"],
      ["assistant", "Moved the testing bullet first."],
    ]);
    expect(chat[1].resumeVersionId).toBe(v.id);
    expect(await prisma.aiCall.count({ where: { purpose: "refine" } })).toBe(1);
    expect(await prisma.agentAction.count({ where: { type: "resume.refined" } })).toBe(1);
  });

  it("sends the current version, the earlier chat and the instruction, but no contact details", async () => {
    const { job, base } = await setup();
    await prisma.resumeChatMessage.create({ data: { jobId: job.id, role: "user", text: "Make it shorter" } });
    const fake = fakeModel(turn(REORDERED));

    await runRefine(job.id, "Lead with testing", base.id, fake.model);

    const p = fake.prompts[0];
    expect(p).toContain("<current_version>");
    expect(p).toContain("Candidate: Make it shorter");
    expect(p).toContain("<instruction>\nLead with testing");
    expect(p).not.toMatch(/@example\.com/);
  });

  it("points the application at the new version", async () => {
    const { job, base } = await setup();
    const app = await prisma.application.create({
      data: { jobId: job.id, idempotencyKey: `apply:${job.id}`, resumeVersionId: base.id },
    });

    const out = await runRefine(job.id, "Lead with testing", base.id, fakeModel(turn(REORDERED)).model);

    expect((await prisma.application.findUniqueOrThrow({ where: { id: app.id } })).resumeVersionId).toBe(out.resumeVersionId);
  });

  it("changed=false makes no version, just the reply", async () => {
    const { job, base } = await setup();
    const out = await runRefine(job.id, "Is it ok?", base.id, fakeModel(turn(BASE, false, "It already fits well.")).model);

    expect(out).toEqual({ reply: "It already fits well.", resumeVersionId: null });
    expect(await prisma.resumeVersion.count()).toBe(1);
  });

  it("asked to add a skill I don't have: the validator rejects it twice, nothing is saved, the reply explains", async () => {
    const { job, base } = await setup();
    const invented = { ...REORDERED, skillsOrder: ["Kubernetes", "PostgreSQL"] };
    const fake = fakeModel(turn(invented), turn(invented));

    const out = await runRefine(job.id, "Add Kubernetes", base.id, fake.model);

    expect(out.resumeVersionId).toBeNull();
    expect(out.reply).toMatch(/couldn't make that change/);
    expect(out.reply).toMatch(/Kubernetes/);
    expect(await prisma.resumeVersion.count()).toBe(1);
    expect(fake.prompts[1]).toContain("<previous_attempt_rejected>");
    expect(await prisma.agentAction.count({ where: { type: "resume.refine_rejected" } })).toBe(2);
    expect(await prisma.aiCall.count({ where: { purpose: "refine" } })).toBe(2); // both attempts were billed
  });

  it("a changed number is rejected, then the corrected retry is saved", async () => {
    const { job, base } = await setup();
    const inflated: TailoredResume = {
      ...BASE,
      sections: [{ sourceId: "acme", bullets: [{ sourceBulletId: "acme-2", text: "Raised coverage from 40% to 95%" }] }],
    };
    const out = await runRefine(job.id, "Make the testing win sound bigger", base.id, fakeModel(turn(inflated), turn(REORDERED)).model);

    expect(out.resumeVersionId).not.toBeNull();
    const saved = await prisma.resumeVersion.findUniqueOrThrow({ where: { id: out.resumeVersionId! } });
    expect(JSON.stringify(saved.tailored)).not.toContain("95%");
  });

  it("refines share the daily tailor cap", async () => {
    const { job, base } = await setup();
    await prisma.settings.update({ where: { id: 1 }, data: { maxTailorsPerDay: 1 } });
    await prisma.aiCall.create({ data: { purpose: "tailor", model: "m", inputTokens: 1, outputTokens: 1 } });

    await expect(runRefine(job.id, "Lead with testing", base.id, fakeModel(turn(REORDERED)).model)).rejects.toThrow(
      TailorCapError,
    );
  });

  it("refuses a version from another job", async () => {
    const { base } = await setup();
    const other = await prisma.job.create({ data: { company: "B", title: "T", description: "d" } });
    await expect(runRefine(other.id, "x", base.id, fakeModel(turn(REORDERED)).model)).rejects.toThrow(TailorError);
  });
});
