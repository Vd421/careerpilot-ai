import type { HttpGet, JobSource, RawJob, SourceQuery } from "../contracts.js";
import { titleMatches } from "./keywords.js";
import { SOURCE_META } from "./meta.js";
import { arr, defaultHttpGet, getJson, htmlToText, platformFromUrl, rec, str } from "./util.js";

// Remotive asks for few calls/day, so ONE request per run (category feed) and we filter titles ourselves.
export function mapRemotive(body: unknown, keywords: string[]): RawJob[] {
  const out: RawJob[] = [];
  for (const raw of arr(rec(body).jobs)) {
    const j = rec(raw);
    const title = str(j.title);
    const url = str(j.url);
    if (!title || !url || j.id == null || !titleMatches(title, keywords)) continue;
    const posted = str(j.publication_date);
    const date = posted ? new Date(`${posted}Z`) : null; // Remotive times are UTC without a zone
    out.push({
      source: "remotive",
      externalId: String(j.id),
      company: str(j.company_name) ?? "Unknown",
      title,
      url,
      description: htmlToText(str(j.description) ?? ""),
      location: str(j.candidate_required_location),
      remote: true,
      salaryMin: null, // free text ("$1000 per task"), not reliable
      salaryMax: null,
      salaryCurrency: null,
      postedAt: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
      applyPlatform: platformFromUrl(url), // remotive.com link -> "other" -> manual apply
    });
  }
  return out;
}

export const remotiveSource: JobSource = {
  meta: SOURCE_META.remotive,
  async fetch(query: SourceQuery, http: HttpGet = defaultHttpGet) {
    const body = await getJson(http, "https://remotive.com/api/remote-jobs?category=software-dev");
    return body ? mapRemotive(body, query.keywords) : [];
  },
};
