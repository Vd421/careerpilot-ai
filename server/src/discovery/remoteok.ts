import type { HttpGet, JobSource, RawJob, SourceQuery } from "../contracts.js";
import { titleMatches } from "./keywords.js";
import { SOURCE_META } from "./meta.js";
import { arr, defaultHttpGet, getJson, htmlToText, isoFromEpoch, num, platformFromUrl, rec, str } from "./util.js";

export function mapRemoteOk(body: unknown, keywords: string[]): RawJob[] {
  const out: RawJob[] = [];
  // Item 0 is the legal notice (no `position` / `id`), so the checks below skip it.
  for (const raw of arr(body)) {
    const j = rec(raw);
    const title = str(j.position);
    const url = str(j.url) ?? str(j.apply_url);
    if (!title || !url || j.id == null || !titleMatches(title, keywords)) continue;
    const min = (num(j.salary_min) ?? 0) > 0 ? num(j.salary_min) : null; // 0 means "not given"
    const max = (num(j.salary_max) ?? 0) > 0 ? num(j.salary_max) : null;
    out.push({
      source: "remoteok",
      externalId: String(j.id),
      company: str(j.company) ?? "Unknown",
      title,
      url,
      description: htmlToText(str(j.description) ?? ""),
      location: str(j.location),
      remote: true,
      salaryMin: min,
      salaryMax: max,
      salaryCurrency: min || max ? "USD" : null, // their feed is yearly USD
      postedAt: isoFromEpoch(num(j.epoch)),
      applyPlatform: platformFromUrl(url),
    });
  }
  return out;
}

export const remoteOkSource: JobSource = {
  meta: SOURCE_META.remoteok,
  async fetch(query: SourceQuery, http: HttpGet = defaultHttpGet) {
    const body = await getJson(http, "https://remoteok.com/api");
    return body ? mapRemoteOk(body, query.keywords) : [];
  },
};
