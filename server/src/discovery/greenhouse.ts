import type { HttpGet, JobSource, RawJob, SourceQuery } from "../contracts.js";
import { BOARD_PAUSE_MS, loadTargetCompanies, sleep } from "./boards.js";
import { titleMatches } from "./keywords.js";
import { SOURCE_META } from "./meta.js";
import { arr, defaultHttpGet, escapedHtmlToText, getJson, looksRemote, rec, str } from "./util.js";

export const greenhouseListUrl = (token: string) =>
  `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`;

// One posting (from the list or the single-job endpoint, same shape). Null if unusable.
export function mapGreenhouseJob(raw: unknown, token: string): RawJob | null {
  const j = rec(raw);
  const title = str(j.title);
  const url = str(j.absolute_url);
  if (!title || !url || j.id == null) return null;
  const location = str(rec(j.location).name);
  const updated = str(j.first_published) ?? str(j.updated_at);
  const date = updated ? new Date(updated) : null;
  return {
    source: "greenhouse",
    externalId: String(j.id),
    company: str(j.company_name) ?? token,
    title,
    url,
    description: escapedHtmlToText(str(j.content) ?? ""),
    location,
    remote: looksRemote(location, title),
    salaryMin: null, // Greenhouse's public API has no salary field
    salaryMax: null,
    salaryCurrency: null,
    postedAt: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
    applyPlatform: "greenhouse",
  };
}

export function createGreenhouseSource(opts: { companies?: string[]; pauseMs?: number } = {}): JobSource {
  return {
    meta: SOURCE_META.greenhouse,
    async fetch(query: SourceQuery, http: HttpGet = defaultHttpGet) {
      const tokens = opts.companies ?? loadTargetCompanies().greenhouse;
      const out: RawJob[] = [];
      for (const [i, token] of tokens.entries()) {
        if (i > 0) await sleep(opts.pauseMs ?? BOARD_PAUSE_MS);
        const body = await getJson(http, greenhouseListUrl(token)); // one bad board never aborts the run
        for (const raw of arr(rec(body).jobs)) {
          const job = mapGreenhouseJob(raw, token);
          if (job && titleMatches(job.title, query.keywords)) out.push(job);
        }
      }
      return out;
    },
  };
}

export const greenhouseSource = createGreenhouseSource();
