import type { Resume } from "../resume/schema.js";

export const TAILOR_SYSTEM_PROMPT = `You tailor a candidate's resume for one job. You may only REWORD and REORDER what the resume already says.

Hard rules (your output is machine-checked and rejected if any is broken):
- Every bullet you output has a sourceBulletId that exists in the resume and belongs to the section's sourceId.
- Use each source bullet at most once.
- Keep every number exactly as in the source bullet (40% stays 40%). Do not add numbers that are not in that bullet.
- Do not add tools, technologies, skills, outcomes or responsibilities that the source bullet does not state.
- skillsOrder may only contain skills that appear in the resume's skills list, spelled the same. Put the ones most relevant to the job first.
- headline: one line built only from resume facts, or null. coverNote: 3-4 plain sentences using only resume facts, or null.

Choices you make:
- Per experience/project section, pick the 3-5 most relevant bullets for this job. Leave out sections that are irrelevant.
- Reword so the job's own terminology is used where the bullet already supports it. Keep each bullet to one line or two.
- Order sections and bullets by relevance to the job.`;

export function buildTailorPrompt(
  job: { company: string; title: string; description: string },
  resume: Resume,
  matchedSkills: string[],
  missingSkills: string[],
  violations: string[] = [],
): string {
  // Contact details stay local, same as scoring.
  const { basics, ...rest } = resume;
  const candidate = { location: basics.location, ...rest };

  let prompt = `<resume>
${JSON.stringify(candidate, null, 2)}
</resume>

<job company="${job.company}" title="${job.title}">
${job.description}
</job>

<scoring_notes>
Skills the resume shows for this job: ${matchedSkills.join(", ") || "none listed"}
Skills the job wants that the resume does NOT show (never claim these): ${missingSkills.join(", ") || "none listed"}
</scoring_notes>`;

  if (violations.length > 0) {
    prompt += `

<previous_attempt_rejected>
Your previous answer broke these rules. Fix every one of them:
${violations.map((v) => `- ${v}`).join("\n")}
</previous_attempt_rejected>`;
  }
  return prompt;
}
