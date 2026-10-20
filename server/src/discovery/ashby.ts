import type { HttpGet, JobSource, RawJob, SourceQuery } from "../contracts.js";
import { BOARD_PAUSE_MS, loadTargetCompanies, sleep } from "./boards.js";
import { titleMatches } from "./keywords.js";
import { SOURCE_META } from "./meta.js";
import { arr, defaultHttpGet, getJson, htmlToText, num, rec, str, toYearly } from "./util.js";

export const ashbyListUrl = (name: string) =>
  `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(name)}?includeCompensation=true`;

// Salary lives in compensation.summaryComponents, e.g. { compensationType: "Salary", interval: "1 YEAR", ... }
function salaryOf(compensation: unknown) {
  const comp = arr(rec(compensation).summaryComponents)
    .map(rec)
    .find((c) => String(c.compensationType).toLowerCase() === "salary");
  if (!comp) return { min: null, max: null, currency: null };
  const interval = str(comp.interval);
  return {
    min: toYearly(num(comp.minValue), interval),
    max: toYearly(num(comp.maxValue), interval),
    currency: str(comp.currencyCode),
  };
}

export function mapAshbyJob(raw: unknown, board: string): RawJob | null {
  const j = rec(raw);
  const title = str(j.title);
  const url = str(j.jobUrl);
  const id = str(j.id);
  if (!title || !url || !id || j.isListed === false) return null;
  const salary = salaryOf(j.compensation);
  const published = str(j.publishedAt);
  const date = published ? new Date(published) : null;
  const location = str(j.location);
  return {
    source: "ashby",
    externalId: id,
    company: board,
    title,
    url,
    description: str(j.descriptionPlain) ?? htmlToText(str(j.descriptionHtml) ?? ""),
    location,
    remote:
      typeof j.isRemote === "boolean" ? j.isRemote : j.workplaceType === "Remote" ? true : /\bremote\b/i.test(location ?? "") ? true : null,
    salaryMin: salary.min,
    salaryMax: salary.max,
    salaryCurrency: salary.currency,
    postedAt: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
    applyPlatform: "ashby",
  };
}

export function createAshbySource(opts: { companies?: string[]; pauseMs?: number } = {}): JobSource {
  return {
    meta: SOURCE_META.ashby,
    async fetch(query: SourceQuery, http: HttpGet = defaultHttpGet) {
      const boards = opts.companies ?? loadTargetCompanies().ashby;
      const out: RawJob[] = [];
      for (const [i, board] of boards.entries()) {
        if (i > 0) await sleep(opts.pauseMs ?? BOARD_PAUSE_MS);
        const body = await getJson(http, ashbyListUrl(board));
        for (const raw of arr(rec(body).jobs)) {
          const job = mapAshbyJob(raw, board);
          if (job && titleMatches(job.title, query.keywords)) out.push(job);
        }
      }
      return out;
    },
  };
}

export const ashbySource = createAshbySource();
