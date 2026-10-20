import express, { Router } from "express";
import { applicationsRouter } from "./applications.js";
import { defaultDeps, type ApiDeps } from "./deps.js";
import { errorHandler, HttpError } from "./errors.js";
import { jobsRouter } from "./jobs.js";
import { loopsRouter } from "./loops.js";
import { miscRouter } from "./misc.js";

export type { ApiDeps } from "./deps.js";

// Mounted by app.ts at /api. There is deliberately NO route that sets approvedAt or submitApprovedAt:
// those two taps come only from Telegram.
export function createApiRouter(deps: ApiDeps): Router {
  const r = Router();
  r.use(express.json({ limit: "1mb" }));
  r.use(miscRouter(deps));
  r.use(jobsRouter(deps));
  r.use(applicationsRouter(deps));
  r.use(loopsRouter(deps));
  r.use(() => {
    throw new HttpError(404, "Not found");
  });
  r.use(errorHandler);
  return r;
}

export const apiRouter = createApiRouter(defaultDeps);
