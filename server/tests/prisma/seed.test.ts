import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resolve } from "node:path";
import { prisma } from "../../src/db.js";
import { resetDb } from "../helpers/resetDb.js";
import { seedDatabase } from "../../prisma/seed.js";

const example = resolve(import.meta.dirname, "../../../data/resume.example.json");
const missing = resolve(import.meta.dirname, "../../../data/does-not-exist.json");

describe("seedDatabase", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("creates Settings and variant A", async () => {
    await seedDatabase(prisma, { resumeA: example, resumeB: missing });
    expect((await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })).dailyCap).toBe(15);
    const variants = await prisma.resumeVariant.findMany();
    expect(variants.map((v) => v.name)).toEqual(["A"]);
  });

  it("adds variant B when its file exists", async () => {
    await seedDatabase(prisma, { resumeA: example, resumeB: example });
    expect(await prisma.resumeVariant.count()).toBe(2);
  });

  it("is idempotent and keeps edited settings", async () => {
    await seedDatabase(prisma, { resumeA: example, resumeB: missing });
    await prisma.settings.update({ where: { id: 1 }, data: { dailyCap: 5 } });
    await seedDatabase(prisma, { resumeA: example, resumeB: missing });
    expect(await prisma.resumeVariant.count()).toBe(1);
    expect((await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })).dailyCap).toBe(5);
  });
});
