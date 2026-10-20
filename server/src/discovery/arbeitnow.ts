import type { HttpGet, JobSource, RawJob, SourceQuery } from "../contracts.js";
import { titleMatches } from "./keywords.js";
import { SOURCE_META } from "./meta.js";
import { arr, defaultHttpGet, getJson, htmlToText, isoFromEpoch, num, platformFromUrl, rec, str } from "./util.js";

export function mapArbeitnow(body: unknown, keywords: string[]): RawJob[] {
  const out: RawJob[] = [];
  for (const raw of arr(rec(body).data)) {
    const j = rec(raw);
    const title = str(j.title);
    const url = str(j.url);
    const slug = str(j.slug);
    if (!title || !url || !slug || !titleMatches(title, keywords)) continue;
    out.push({
      source: "arbeitnow",
      externalId: slug,
      company: str(j.company_name) ?? "Unknown",
      title,
      url,
      description: htmlToText(str(j.description) ?? ""),
      location: str(j.location),
      remote: typeof j.remote === "boolean" ? j.remote : null,
      salaryMin: null, // the feed has no salary
      salaryMax: null,
      salaryCurrency: null,
      postedAt: isoFromEpoch(num(j.created_at)),
      applyPlatform: platformFromUrl(url),
    });
  }
  return out;
}

export const arbeitnowSource: JobSource = {
  meta: SOURCE_META.arbeitnow,
  async fetch(query: SourceQuery, http: HttpGet = defaultHttpGet) {
    const body = await getJson(http, "https://www.arbeitnow.com/api/job-board-api");
    return body ? mapArbeitnow(body, query.keywords) : [];
  },
};
