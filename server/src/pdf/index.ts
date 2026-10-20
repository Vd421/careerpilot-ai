import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { chromium } from "playwright";
import type { RenderResumePdf, TailoredResume } from "../contracts.js";
import { prisma } from "../db.js";
import { loadResume } from "../resume/load.js";
import { PRIVATE_DIR, REPO_ROOT, resolveRepoPath } from "../tailor/paths.js";
import { tailoredResumeSchema } from "../tailor/schema.js";
import { renderResumeHtml } from "./html.js";

export { renderResumeHtml } from "./html.js";

export class PdfError extends Error {
  name = "PdfError";
}

// Playwright lives behind this so tests can skip the browser.
export type HtmlToPdf = (html: string) => Promise<Buffer>;

export const chromiumHtmlToPdf: HtmlToPdf = async (html) => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    return Buffer.from(await page.pdf({ format: "A4", printBackground: false }));
  } finally {
    await browser.close(); // never leave a headless browser running if pdf() throws
  }
};

export interface PdfDeps {
  htmlToPdf?: HtmlToPdf;
  outDir?: string; // default data/private/pdfs
}

export async function renderPdfFor(
  resumeVersionId: number,
  deps: PdfDeps = {},
): Promise<{ pdfPath: string }> {
  const version = await prisma.resumeVersion.findUnique({
    where: { id: resumeVersionId },
    include: { variant: true, job: { include: { application: true } } },
  });
  if (!version) throw new PdfError(`Resume version ${resumeVersionId} not found`);

  // Variant may have been deleted (SetNull); fall back to the first one rather than failing.
  const variant = version.variant ?? (await prisma.resumeVariant.findFirst({ orderBy: { id: "asc" } }));
  if (!variant) throw new PdfError("No resume variant found. Run `npm run db:seed` first.");

  const resume = loadResume(resolveRepoPath(variant.filePath));
  const tailored: TailoredResume = tailoredResumeSchema.parse(version.tailored);
  const html = renderResumeHtml(resume, tailored);
  const pdf = await (deps.htmlToPdf ?? chromiumHtmlToPdf)(html);

  const outDir = deps.outDir ?? join(PRIVATE_DIR, "pdfs");
  await mkdir(outDir, { recursive: true });
  const abs = join(outDir, `${resumeVersionId}.pdf`);
  await writeFile(abs, pdf);

  // Stored relative to the repo root when inside it, so it survives moving machines.
  const stored = abs.startsWith(REPO_ROOT) ? relative(REPO_ROOT, abs).replaceAll("\\", "/") : abs;
  await prisma.resumeVersion.update({ where: { id: resumeVersionId }, data: { pdfPath: stored } });
  await prisma.agentAction.create({
    data: {
      type: "resume.pdf_rendered",
      jobId: version.jobId,
      applicationId: version.job.application?.id ?? null,
      loopId: version.job.loopId,
      detail: { resumeVersionId, pdfPath: stored, bytes: pdf.length },
    },
  });
  return { pdfPath: stored };
}

// Contract entry point.
export const renderResumePdf: RenderResumePdf = (id) => renderPdfFor(id);
