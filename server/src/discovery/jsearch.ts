import type { HttpGet, JobSource, RawJob, SourceQuery } from "../contracts.js";
import { SOURCE_META } from "./meta.js";
import { arr, defaultHttpGet, getJson, htmlToText, num, platformFromUrl, rec, str, toYearly } from "./util.js";

const MAX_CALLS = 2; // free plan is tiny (~200 requests/month): at most 2 searches per run

export function mapJSearch(body: unknown): RawJob[] {
  const out: RawJob[] = [];
  for (const raw of arr(rec(body).data)) {
    const j = rec(raw);
    const title = str(j.job_title);
    const id = str(j.job_id);
    // Prefer a direct Greenhouse/Lever/Ashby link among the apply options (Indeed etc. stay "other" = manual).
    const options = arr(j.apply_options).map((o) => str(rec(o).apply_link));
    const link = str(j.job_apply_link);
    const url = options.find((u) => u && platformFromUrl(u) !== "other") ?? link ?? options.find(Boolean) ?? null;
    if (!title || !id || !url) continue;
    const period = str(j.job_salary_period);
    const posted = str(j.job_posted_at_datetime_utc);
    const date = posted ? new Date(posted) : null;
    const place = [str(j.job_city), str(j.job_state), str(j.job_country)].filter(Boolean).join(", ");
    out.push({
      source: "jsearch",
      externalId: id,
      company: str(j.employer_name) ?? "Unknown",
      title,
      url,
      description: htmlToText(str(j.job_description) ?? ""),
      location: place || null,
      remote: typeof j.job_is_remote === "boolean" ? j.job_is_remote : null,
      salaryMin: toYearly(num(j.job_min_salary), period),
      salaryMax: toYearly(num(j.job_max_salary), period),
      salaryCurrency: str(j.job_salary_currency),
      postedAt: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
      applyPlatform: platformFromUrl(url),
    });
  }
  return out;
}

export const jsearchSource: JobSource = {
  meta: SOURCE_META.jsearch,
  async fetch(query: SourceQuery, http: HttpGet = defaultHttpGet) {
    const key = process.env.RAPIDAPI_KEY;
    if (!key) {
      console.warn("[discovery] jsearch: RAPIDAPI_KEY not configured, skipping");
      return [];
    }
    const headers = { "X-RapidAPI-Key": key, "X-RapidAPI-Host": "jsearch.p.rapidapi.com" };
    const places = query.locations.length ? query.locations : [""];
    const byId = new Map<string, RawJob>();
    let calls = 0;
    for (const kw of query.keywords) {
      for (const place of places) {
        if (calls >= MAX_CALLS) break;
        calls++;
        const q = encodeURIComponent(place ? `${kw} in ${place}` : kw);
        const body = await getJson(http, `https://jsearch.p.rapidapi.com/search?query=${q}&page=1&num_pages=1&date_posted=week`, headers);
        if (body) for (const job of mapJSearch(body)) byId.set(job.externalId, job);
      }
    }
    return [...byId.values()];
  },
};
