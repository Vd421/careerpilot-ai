import type { TailoredResume } from "../contracts.js";
import type { Resume } from "../resume/schema.js";

// Numbers like 40, 40%, 2.5. Compared as exact tokens, so "40" cannot sneak in where the source says "400".
const NUMBER_RE = /\d+(?:\.\d+)?%?/g;

export function extractNumbers(text: string): string[] {
  return text.match(NUMBER_RE) ?? [];
}

// Returns a list of violations; empty = safe to save. This is the code-level guard behind
// "never invent experience": the model's output is only trusted after passing every rule.
export function validateTailored(tailored: TailoredResume, resume: Resume): string[] {
  const violations: string[] = [];

  // sourceId -> (bulletId -> text), for experience and projects
  const sources = new Map<string, Map<string, string>>();
  for (const s of [...resume.experience, ...resume.projects]) {
    sources.set(s.id, new Map(s.bullets.map((b) => [b.id, b.text])));
  }

  const usedBulletIds = new Set<string>();
  for (const section of tailored.sections) {
    const bullets = sources.get(section.sourceId);
    if (!bullets) {
      violations.push(`Section "${section.sourceId}" is not an experience or project id in the resume`);
      continue;
    }
    if (section.bullets.length === 0) {
      violations.push(`Section "${section.sourceId}" has no bullets`);
    }
    for (const b of section.bullets) {
      const source = bullets.get(b.sourceBulletId);
      if (source === undefined) {
        // Rule 1: id must exist AND belong to this section
        violations.push(`Bullet id "${b.sourceBulletId}" does not exist under "${section.sourceId}"`);
        continue;
      }
      // Rule 2
      if (usedBulletIds.has(b.sourceBulletId)) {
        violations.push(`Bullet id "${b.sourceBulletId}" is used more than once`);
      }
      usedBulletIds.add(b.sourceBulletId);
      // Rule 3
      const allowed = new Set(extractNumbers(source));
      for (const n of extractNumbers(b.text)) {
        if (!allowed.has(n)) {
          violations.push(`Bullet "${b.sourceBulletId}" contains number "${n}" that is not in the source bullet`);
        }
      }
    }
  }

  // Rule 4
  const known = new Set(resume.skills.flatMap((g) => g.items.map((i) => i.toLowerCase())));
  for (const skill of tailored.skillsOrder) {
    if (!known.has(skill.toLowerCase())) {
      violations.push(`Skill "${skill}" is not in the resume skills`);
    }
  }

  // Extra: the headline and cover note are free text, so their numbers must exist somewhere in the resume.
  const resumeNumbers = new Set(extractNumbers(JSON.stringify({ ...resume, basics: undefined })));
  for (const [field, text] of [
    ["headline", tailored.headline],
    ["coverNote", tailored.coverNote],
  ] as const) {
    for (const n of extractNumbers(text ?? "")) {
      if (!resumeNumbers.has(n)) violations.push(`The ${field} contains number "${n}" that is not in the resume`);
    }
  }

  return violations;
}
