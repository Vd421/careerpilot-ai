import type { RefineResume, TailorForJob } from "../contracts.js";
import { runRefine } from "./refine.js";
import { runTailor } from "./tailorForJob.js";

export { TailorError, TailorCapError, runTailor, claudeTailorModel, type TailorModel } from "./tailorForJob.js";
export { validateTailored } from "./validate.js";
export { runRefine, claudeRefineModel, refineSchema } from "./refine.js";

// The contract entry point other modules call. Uses the real Claude model.
export const tailorForJob: TailorForJob = (jobId, variantId) => runTailor(jobId, variantId);

// Refine chat: one turn, same no-invention validator as tailoring.
export const refineResume: RefineResume = (jobId, message, baseVersionId) => runRefine(jobId, message, baseVersionId);
