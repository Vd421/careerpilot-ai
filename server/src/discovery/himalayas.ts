import type { HttpGet, JobSource, RawJob, SourceQuery } from "../contracts.js";
import { titleMatches } from "./keywords.js";
import { SOURCE_META } from "./meta.js";
import { arr, defaultHttpGet, getJson, htmlToText, isoFromEpoch, num, platformFromUrl, rec, str, toYearly } from "./util.js";

const MAX_KEYWORD_CALLS = 3; // be gentle: page 1 of the search endpoint per keyword

export function mapHimalayas(body: unknown, keywords: string[]): RawJob[] {
  const out: RawJob[] = [];
  for (const raw of arr(rec(body).jobs)) {
    const j = rec(raw);
    const title = str(j.title);
    // applicationLink is what their terms say to use when applying
    const url = str(j.applicationLink) ?? str(j.guid);
    if (!title || !url || !titleMatches(title, keywords)) continue;
    const period = str(j.salaryPeriod);
    const restrictions = arr(j.locationRestrictions).filter((x): x is string => typeof x === "string");
    out.push({
      source: "himalayas",
      externalId: str(j.guid) ?? url,
      company: str(j.companyName) ?? "Unknown",
      title,
      url,
      description: htmlToText(str(j.description) ?? str(j.excerpt) ?? ""),
      location: restrictions.length ? restrictions.join(", ") : "Worldwide",
      remote: true,
      salaryMin: toYearly(num(j.minSalary), period),
      salaryMax: toYearly(num(j.maxSalary), period),
      salaryCurrency: str(j.currency),
      postedAt: isoFromEpoch(num(j.pubDate)),
      applyPlatform: platformFromUrl(url),
    });
  }
  return out;
}

export const himalayasSource: JobSource = {
  meta: SOURCE_META.himalayas,
  async fetch(query: SourceQuery, http: HttpGet = defaultHttpGet) {
    const byId = new Map<string, RawJob>();
    for (const kw of query.keywords.slice(0, MAX_KEYWORD_CALLS)) {
      const body = await getJson(http, `https://himalayas.app/jobs/api/search?q=${encodeURIComponent(kw)}`);
      // keywords already narrowed server-side; the title check is a safety net
      if (body) for (const job of mapHimalayas(body, query.keywords)) byId.set(job.externalId, job);
    }
    return [...byId.values()];
  },
};
