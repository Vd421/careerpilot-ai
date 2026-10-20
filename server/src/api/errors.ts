import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { ApiError } from "../contracts.js";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

// Validate input with Zod; any failure becomes a 400 ApiError.
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, "Invalid request", r.error.issues);
  return r.data;
}

const idSchema = z.coerce.number().int().positive();
export function parseId(value: unknown, name = "id"): number {
  const r = idSchema.safeParse(value);
  if (!r.success) throw new HttpError(400, `Invalid ${name}`);
  return r.data;
}

export function notFound(what: string): never {
  throw new HttpError(404, `${what} not found`);
}

// Express 5 forwards rejected promises here automatically.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    const body: ApiError = { error: err.message, details: err.details };
    res.status(err.status).json(body);
    return;
  }
  // Malformed JSON body from express.json()
  if (err && typeof err === "object" && (err as { type?: string }).type === "entity.parse.failed") {
    res.status(400).json({ error: "Invalid JSON body" } satisfies ApiError);
    return;
  }
  // Prisma "record not found" from findUniqueOrThrow / update
  if (err && typeof err === "object" && (err as { code?: string }).code === "P2025") {
    res.status(404).json({ error: "Not found" } satisfies ApiError);
    return;
  }
  console.error("API error:", err);
  res.status(500).json({ error: "Internal error" } satisfies ApiError);
}
