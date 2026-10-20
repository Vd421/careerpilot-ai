import { mapToOption } from "../answers/normalize.js";
import { answerValue } from "../answers/match.js";
import type { FormField } from "../contracts.js";
import type { Answer, Question } from "../generated/prisma/client.js";
import type { Resume } from "../resume/schema.js";
import { standardKeyOf, type StandardKey } from "./prescan.js";

// Standard form fields come from resume.json basics/links, never from a Telegram question.
export function standardValues(resume: Resume): Partial<Record<StandardKey, string>> {
  const b = resume.basics;
  const parts = b.name.trim().split(/\s+/);
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  const first = parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0];
  const link = (re: RegExp) => b.links.find((l) => re.test(`${l.label} ${l.url}`))?.url;
  const other = b.links.find((l) => !/linkedin|github/i.test(`${l.label} ${l.url}`));
  return {
    first_name: first || undefined,
    last_name: last || undefined,
    full_name: b.name,
    email: b.email,
    phone: b.phone || undefined,
    linkedin: link(/linkedin/i),
    github: link(/github/i),
    website: link(/portfolio|website|personal|site/i) ?? other?.url,
  };
}

export type QuestionWithAnswer = Question & { answer: Answer | null };

export interface AnswerLine {
  label: string;
  value: string | null; // null = still unanswered
  required: boolean;
}

export interface FillPlan {
  values: Record<string, string>; // field name -> value (what goes into FillRequest.answers)
  lines: AnswerLine[]; // human-readable, for the "ready to submit" card and the manual message
  missingRequired: FormField[]; // required fields we have no approved answer for
  hasResumeField: boolean;
}

// Only APPROVED answers ever fill a form (hard rule). A draft or unapproved row counts as "no answer".
export const approvedValue = (q: QuestionWithAnswer): string | null =>
  q.answer && q.answer.approved ? answerValue(q.answer) || null : null;

export function buildFillPlan(fields: FormField[], questions: QuestionWithAnswer[], resume: Resume): FillPlan {
  const std = standardValues(resume);
  const values: Record<string, string> = {};
  const lines: AnswerLine[] = [];
  const missingRequired: FormField[] = [];
  let hasResumeField = false;

  for (const f of fields) {
    const key = standardKeyOf(f);
    if (key === "phone_country") continue; // phone is typed with its +country code
    if (key === "resume") {
      hasResumeField = true;
      lines.push({ label: f.label, value: "(your tailored resume PDF)", required: f.required });
      continue;
    }
    if (key === "cover_letter") {
      if (f.required) missingRequired.push(f);
      continue;
    }
    if (f.type === "file") {
      if (f.required) missingRequired.push(f);
      continue;
    }

    let value: string | null = key ? (std[key] ?? null) : null;
    if (value == null) {
      const q = questions.find((x) => x.fieldName === f.name);
      value = q ? approvedValue(q) : null;
    }
    if (value != null && (f.type === "select" || f.type === "radio") && f.options.length > 0) {
      value = mapToOption(value, f.options); // a value that isn't one of the options is no value
    }
    if (value != null) {
      values[f.name] = value;
      lines.push({ label: f.label, value, required: f.required });
    } else if (f.required) {
      missingRequired.push(f);
      lines.push({ label: f.label, value: null, required: true });
    }
  }
  return { values, lines, missingRequired, hasResumeField };
}

export function formatLines(lines: AnswerLine[]): string {
  return lines.map((l) => `${l.label}${l.required ? " *" : ""}: ${l.value ?? "(no answer yet)"}`).join("\n");
}
