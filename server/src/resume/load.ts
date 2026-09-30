import { readFileSync } from "node:fs";
import { z } from "zod";
import { resumeSchema, type Resume } from "./schema.js";

// Our own error type, so callers can tell "bad resume" apart from other crashes.
export class ResumeError extends Error {
  name = "ResumeError";
}

export function loadResume(path: string): Resume {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new ResumeError(`Cannot read resume file: ${path}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new ResumeError(`Resume is not valid JSON: ${(err as Error).message}`);
  }

  const result = resumeSchema.safeParse(json);
  if (!result.success) {
    throw new ResumeError(`Invalid resume:\n${z.prettifyError(result.error)}`);
  }

  assertUniqueIds(result.data);
  return result.data;
}

// Every experience, project and bullet id must be unique across the whole resume.
// If two bullets shared an id, a tailored bullet couldn't be traced to ONE source.
function assertUniqueIds(resume: Resume): void {
  const ids = [
    ...resume.experience.flatMap((e) => [e.id, ...e.bullets.map((b) => b.id)]),
    ...resume.projects.flatMap((p) => [p.id, ...p.bullets.map((b) => b.id)]),
  ];

  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new ResumeError(`Duplicate id in resume: "${id}"`);
    }
    seen.add(id);
  }
}
