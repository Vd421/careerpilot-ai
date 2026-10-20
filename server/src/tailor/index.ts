import type { TailorForJob } from "../contracts.js";
import { runTailor } from "./tailorForJob.js";

export { TailorError, runTailor, claudeTailorModel, type TailorModel } from "./tailorForJob.js";
export { validateTailored } from "./validate.js";

// The contract entry point other modules call. Uses the real Claude model.
export const tailorForJob: TailorForJob = (jobId, variantId) => runTailor(jobId, variantId);
