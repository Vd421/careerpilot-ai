import type { HttpGet, JobSource, RawJob, SourceQuery } from "../contracts.js";
import { BOARD_PAUSE_MS, loadTargetCompanies, sleep } from "./boards.js";
import { titleMatches } from "./keywords.js";
import { SOURCE_META } from "./meta.js";
import { arr, defaultHttpGet, getJson, isoFromEpoch, num, rec, str, toYearly } from "./util.js";

export const leverListUrl = (company: string, host = "api.lever.co") =>
  `https://${host}/v0/postings/${encodeURIComponent(company)}?mode=json`;

export function mapLeverJob(raw: unknown, company: string): RawJob | null {
  const j = rec(raw);
  const title = str(j.text);
  const url = str(j.hostedUrl);
  const id = str(j.id);
  if (!title || !url || !id) return null;
  const cats = rec(j.categories);
  const range = rec(j.salaryRange);
  const interval = str(range.interval);
  // Lever's plain description is split in pieces; join the opening, body and bullet lists.
  const lists = arr(j.lists)
    .map((l) => `${str(rec(l).text) ?? ""}\n${str(rec(l).content) ?? ""}`)
    .join("\n");
  const description = [str(j.openingPlain), str(j.descriptionPlain), lists, str(j.additionalPlain)]
    .filter(Boolean)
    .join("\n\n");
  return {
    source: "lever",
    externalId: id,
    company, // the Lever API does not return a display name; the board slug is the best we have
    title,
    url,
    description,
    location: str(cats.location),
    remote: j.workplaceType === "remote" ? true : j.workplaceType === "onsite" ? false : null,
    salaryMin: toYearly(num(range.min), interval),
    salaryMax: toYearly(num(range.max), interval),
    salaryCurrency: str(range.currency),
    postedAt: isoFromEpoch(num(j.createdAt), "ms"),
    applyPlatform: "lever",
  };
}

export function createLeverSource(opts: { companies?: string[]; pauseMs?: number } = {}): JobSource {
  return {
    meta: SOURCE_META.lever,
    async fetch(query: SourceQuery, http: HttpGet = defaultHttpGet) {
      const companies = opts.companies ?? loadTargetCompanies().lever;
      const out: RawJob[] = [];
      for (const [i, company] of companies.entries()) {
        if (i > 0) await sleep(opts.pauseMs ?? BOARD_PAUSE_MS);
        const body = await getJson(http, leverListUrl(company));
        for (const raw of arr(body)) {
          const job = mapLeverJob(raw, company);
          if (job && titleMatches(job.title, query.keywords)) out.push(job);
        }
      }
      return out;
    },
  };
}

export const leverSource = createLeverSource();
