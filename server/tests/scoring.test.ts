import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resolve } from "node:path";
import { prisma } from "../src/db.js";
import { loadResume } from "../src/resume/load.js";
import { buildScoringPrompt } from "../src/scoring/prompt.js";
import { scoreJob, ScoringError, type ScoringModel } from "../src/scoring/scoreJob.js";
import type { ModelResult } from "../src/ai/client.js";

const resume = loadResume(resolve(import.meta.dirname, "../../data/resume.example.json"));

const GOOD_SCORE = {
  matchScore: 72,
  summary: "Strong Node + Postgres match; no Kafka.",
  matchedSkills: ["TypeScript", "PostgreSQL"],
  missingSkills: ["Kafka"],
  redFlags: [{ type: "seniority", detail: "Asks for 3+ years" }],
};

// A fake Claude: returns whatever output we give it, and records the prompt it was sent.
function fakeModel(output: unknown) {
  const calls: { system: string; user: string }[] = [];
  const model: ScoringModel = async (system, user) => {
    calls.push({ system, user });
    const result: ModelResult = {
      output,
      model: "fake-model",
      inputTokens: 1200,
      outputTokens: 150,
      stopReason: "end_turn",
    };
    return result;
  };
  return { model, calls };
}

async function createJob() {
  return prisma.job.create({
    data: { company: "Acme", title: "Backend Engineer", description: "Node, Postgres, Kafka. 3+ years." },
  });
}

describe("scoreJob", () => {
  beforeEach(async () => {
    await prisma.aiCall.deleteMany();
    await prisma.job.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("saves the score on the job", async () => {
    const job = await createJob();

    const score = await scoreJob(job.id, resume, fakeModel(GOOD_SCORE).model);

    const saved = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(score.matchScore).toBe(72);
    expect(saved.matchScore).toBe(72);
    expect(saved.missingSkills).toEqual(["Kafka"]);
    expect(saved.redFlags).toEqual([{ type: "seniority", detail: "Asks for 3+ years" }]);
    expect(saved.scoredAt).toBeInstanceOf(Date);
  });

  it("logs token usage for the call", async () => {
    const job = await createJob();

    await scoreJob(job.id, resume, fakeModel(GOOD_SCORE).model);

    const calls = await prisma.aiCall.findMany();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      purpose: "score",
      model: "fake-model",
      inputTokens: 1200,
      outputTokens: 150,
      jobId: job.id,
    });
  });

  it("sends the JD and resume bullets to the model", async () => {
    const job = await createJob();
    const fake = fakeModel(GOOD_SCORE);

    await scoreJob(job.id, resume, fake.model);

    expect(fake.calls[0].user).toContain("Node, Postgres, Kafka");
    expect(fake.calls[0].user).toContain("acme-1");
  });

  it("rejects an out-of-range score and leaves the job unscored (but still logs the cost)", async () => {
    const job = await createJob();

    await expect(
      scoreJob(job.id, resume, fakeModel({ ...GOOD_SCORE, matchScore: 150 }).model),
    ).rejects.toThrow(ScoringError);

    const saved = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(saved.matchScore).toBeNull();
    expect(await prisma.aiCall.count()).toBe(1);
  });

  it("rejects a null answer (e.g. model hit max_tokens)", async () => {
    const job = await createJob();

    await expect(scoreJob(job.id, resume, fakeModel(null).model)).rejects.toThrow(ScoringError);
  });
});

describe("buildScoringPrompt", () => {
  it("does not send contact details", () => {
    const prompt = buildScoringPrompt("Some JD", resume);

    expect(prompt).not.toContain(resume.basics.email);
    expect(prompt).not.toContain(resume.basics.name);
  });
});
