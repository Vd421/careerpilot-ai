import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db.js";

describe("Job model", () => {
  // Start every test with an empty table so tests don't affect each other
  beforeEach(async () => {
    await prisma.job.deleteMany();
  });

  // Close the DB connection when done, or Vitest may hang
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("saves a job and reads it back", async () => {
    const created = await prisma.job.create({
      data: {
        company: "Stripe",
        title: "Backend Engineer",
        url: "https://stripe.com/jobs/123",
        description: "Build payment APIs with Node and Postgres.",
      },
    });

    const found = await prisma.job.findUnique({ where: { id: created.id } });

    expect(found).not.toBeNull();
    expect(found?.company).toBe("Stripe");
    expect(found?.title).toBe("Backend Engineer");
    expect(found?.url).toBe("https://stripe.com/jobs/123");
    expect(found?.createdAt).toBeInstanceOf(Date);
  });

  it("allows url to be empty (pasted JD with no link)", async () => {
    const created = await prisma.job.create({
      data: {
        company: "Razorpay",
        title: "SDE 1",
        description: "Pasted JD text.",
      },
    });

    const found = await prisma.job.findUnique({ where: { id: created.id } });

    expect(found?.url).toBeNull();
  });
});
