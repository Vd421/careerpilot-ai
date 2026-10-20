import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { prisma } from "../../src/db.js";
import { resetDb } from "../helpers/resetDb.js";
import { loadResume } from "../../src/resume/load.js";
import { renderResumeHtml, renderPdfFor, PdfError } from "../../src/pdf/index.js";
import type { TailoredResume } from "../../src/contracts.js";

const examplePath = resolve(import.meta.dirname, "../../../data/resume.example.json");
const resume = loadResume(examplePath);

const tailored: TailoredResume = {
  headline: "Backend engineer <b>& more</b>",
  sections: [
    {
      sourceId: "acme",
      bullets: [{ sourceBulletId: "acme-2", text: "Raised coverage from 40% to 75% with <script>alert(1)</script> Vitest" }],
    },
    { sourceId: "todo", bullets: [{ sourceBulletId: "todo-1", text: "Built an offline-first todo app" }] },
  ],
  skillsOrder: ["postgresql"],
  coverNote: "never printed in the PDF",
};

describe("renderResumeHtml", () => {
  const html = renderResumeHtml(resume, tailored);

  it("includes every tailored bullet (escaped) and the contact line", () => {
    expect(html).toContain("Raised coverage from 40% to 75% with &lt;script&gt;alert(1)&lt;/script&gt; Vitest");
    expect(html).toContain("Built an offline-first todo app");
    expect(html).toContain(resume.basics.email);
    expect(html).toContain(resume.basics.name);
  });
  it("escapes HTML everywhere", () => {
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>& more</b>");
    expect(html).toContain("&lt;b&gt;&amp; more&lt;/b&gt;");
  });
  it("prints no source bullet text that is not in the tailored version", () => {
    expect(html).not.toContain("Built REST APIs in Node.js"); // acme-1 was not selected
    expect(html).not.toContain("never printed");
  });
  it("has no tables or images (ATS-friendly)", () => {
    expect(html).not.toMatch(/<table|<img/);
  });
  it("puts tailored skill first and keeps the rest", () => {
    expect(html).toContain("<p>PostgreSQL, TypeScript, Python</p>");
  });
  it("shows Present for the current job and education from the source", () => {
    expect(html).toContain("July 2024 - Present");
    expect(html).toContain("Example Institute of Technology");
  });
});

describe("renderPdfFor (fake browser)", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  async function version() {
    const variant = await prisma.resumeVariant.create({ data: { name: "A", filePath: examplePath } });
    const job = await prisma.job.create({ data: { company: "Acme", title: "Eng", description: "x" } });
    return prisma.resumeVersion.create({ data: { jobId: job.id, variantId: variant.id, tailored: tailored as never } });
  }

  it("writes the file, sets pdfPath and logs an action", async () => {
    const v = await version();
    const dir = mkdtempSync(join(tmpdir(), "cp-pdf-"));
    const html: string[] = [];
    const { pdfPath } = await renderPdfFor(v.id, {
      outDir: dir,
      htmlToPdf: async (h) => {
        html.push(h);
        return Buffer.from("%PDF-fake");
      },
    });
    expect(existsSync(join(dir, `${v.id}.pdf`))).toBe(true);
    expect(readFileSync(join(dir, `${v.id}.pdf`), "utf8")).toBe("%PDF-fake");
    expect((await prisma.resumeVersion.findUniqueOrThrow({ where: { id: v.id } })).pdfPath).toBe(pdfPath);
    expect(html[0]).toContain("Built an offline-first todo app");
    expect(await prisma.agentAction.count({ where: { type: "resume.pdf_rendered" } })).toBe(1);
  });

  it("throws PdfError for an unknown version", async () => {
    await expect(renderPdfFor(999, { htmlToPdf: async () => Buffer.from("") })).rejects.toThrow(PdfError);
  });
});

describe.skipIf(process.env.SKIP_BROWSER_TESTS === "1")("renderPdfFor (real Chromium)", () => {
  beforeEach(resetDb);

  it("produces a real PDF", async () => {
    const variant = await prisma.resumeVariant.create({ data: { name: "A", filePath: examplePath } });
    const job = await prisma.job.create({ data: { company: "Acme", title: "Eng", description: "x" } });
    const v = await prisma.resumeVersion.create({ data: { jobId: job.id, variantId: variant.id, tailored: tailored as never } });
    const dir = mkdtempSync(join(tmpdir(), "cp-pdf-real-"));

    await renderPdfFor(v.id, { outDir: dir });

    const bytes = readFileSync(join(dir, `${v.id}.pdf`));
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1000);
  }, 60_000);
});
