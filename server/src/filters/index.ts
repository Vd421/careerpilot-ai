import type { ApplyFilters, FilterSettings, LoopFilters } from "../contracts.js";
import { checkNotice } from "./notice.js";
import { checkSalary } from "./salary.js";
import { maxYearsRequired, seniorTitleWord } from "./seniority.js";

export { dedupeKey } from "./dedupe.js";
export { parseSalaryText, toYearly } from "./salary.js";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Collects ALL reasons (not just the first) so the dashboard shows the full story.
export const applyFilters: ApplyFilters = (job, settings, loop) => {
  const tags: string[] = [];
  const reasons: string[] = [];

  // Salary
  const floors = { ...settings.salaryFloors, ...loop?.salaryFloors };
  const sal = checkSalary(job.salaryMin, job.salaryMax, job.salaryCurrency, floors);
  if (sal.kind === "unknown") tags.push("salary_unknown");
  else if (sal.kind === "below") {
    reasons.push(`Salary ${sal.value} ${sal.currency}/yr is below my floor of ${sal.floor}`);
  }

  // Notice period
  const notice = checkNotice(job.description, settings.noticeDays);
  if (notice.drop) reasons.push(notice.drop);
  else if (notice.risk) tags.push("notice_risk");

  // Seniority: title drops, "N+ years" only tags (scoring decides)
  const word = seniorTitleWord(job.title);
  if (word) reasons.push(`Senior title ("${word}")`);
  const years = maxYearsRequired(job.description);
  if (years !== null && years > settings.maxYearsRequired) tags.push("seniority_risk");

  // Loop filters
  if (loop?.remoteOnly) {
    if (job.remote === false) reasons.push("Not remote");
    else if (job.remote === null && !/remote/i.test(job.location ?? "")) tags.push("remote_unknown");
  }
  for (const kw of loop?.excludeKeywords ?? []) {
    if (!kw.trim()) continue;
    // Title only: descriptions say "work with senior engineers" and would drop good jobs.
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(kw.trim())}(?![\\p{L}\\p{N}])`, "iu").test(job.title)) {
      reasons.push(`Title contains excluded keyword "${kw}"`);
    }
  }

  return { keep: reasons.length === 0, tags, reasons };
};

// Applied AFTER scoring: the loop's minScore wins over the global threshold.
export function passesThreshold(
  score: number,
  settings: Pick<FilterSettings, "matchThreshold">,
  loop?: Pick<LoopFilters, "minScore">,
): boolean {
  return score >= (loop?.minScore ?? settings.matchThreshold);
}
