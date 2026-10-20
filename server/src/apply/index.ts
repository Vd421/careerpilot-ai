import { join } from "node:path";
import type { StartApplication } from "../contracts.js";
import { loadResume } from "../resume/load.js";
import { PRIVATE_DIR, resolveRepoPath } from "../tailor/paths.js";
import { prisma } from "../db.js";
import { createFormFiller } from "./filler.js";
import { fillApplication as fill } from "./fill.js";
import { startApplication as start } from "./start.js";
import type { ApplyDeps } from "./types.js";

export { createFormFiller } from "./filler.js";
export { prescanUrl, standardKeyOf } from "./prescan.js";
export { fillApplication as fillApplicationWith } from "./fill.js";
export { startApplication as startApplicationWith } from "./start.js";
export { goManual } from "./manual.js";
export { buildFillPlan, standardValues } from "./plan.js";
export type { ApplyDeps } from "./types.js";

let deps: ApplyDeps | null = null;

// Real wiring, built on first use so importing this file never starts a browser or touches Telegram.
export async function defaultApplyDeps(): Promise<ApplyDeps> {
  if (deps) return deps;
  const telegram = await import("../telegram/index.js");
  const client = telegram.getTelegramClient();
  deps = {
    filler: createFormFiller(),
    telegram: client,
    askQuestion: (id) => telegram.askQuestionWith(client, id),
    tailorForJob: async (...a) => (await import("../tailor/index.js")).tailorForJob(...a),
    renderResumePdf: async (...a) => (await import("../pdf/index.js")).renderResumePdf(...a),
    enqueue: async (...a) => (await import("../queue/index.js")).enqueue(...a),
    // The base resume of this application's variant (A/B), else the first variant, same rule as scoring.
    loadResume: async (variantId) => {
      const variant = variantId
        ? await prisma.resumeVariant.findUnique({ where: { id: variantId } })
        : await prisma.resumeVariant.findFirst({ orderBy: { id: "asc" } });
      if (!variant) throw new Error("No resume variant found. Run `npm run db:seed` first.");
      return loadResume(resolveRepoPath(variant.filePath));
    },
    screenshotsDir: join(PRIVATE_DIR, "screenshots"),
  };
  return deps;
}

// Contract + queue entry points. The queue calls prescanApplication for apply.prescan and fillApplication for apply.fill.
export const startApplication: StartApplication = async (id) => start(id, await defaultApplyDeps());
export const prescanApplication: StartApplication = startApplication;
export const fillApplication: StartApplication = async (id) => fill(id, await defaultApplyDeps());
