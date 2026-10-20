import type { HttpGet, JobSource, RawJob, SourceQuery } from "../contracts.js";
import { SOURCE_META } from "./meta.js";
import { arr, defaultHttpGet, getJson, htmlToText, num, platformFromUrl, rec, str } from "./util.js";

// Adzuna is country-scoped. Pick the country from the location text; default India (my target market).
const COUNTRIES = [
  { code: "in", currency: "INR", match: /india|bengaluru|bangalore|mumbai|delhi|hyderabad|pune|chennai|gurgaon|gurugram|noida|remote/i },
  { code: "gb", currency: "GBP", match: /uk|united kingdom|england|london/i },
  { code: "us", currency: "USD", match: /usa|united states|\bus\b|new york|san francisco|seattle/i },
] as const;

const MAX_CALLS = 3;

export function mapAdzuna(body: unknown, currency: string): RawJob[] {
  const out: RawJob[] = [];
  for (const raw of arr(rec(body).results)) {
    const j = rec(raw);
    const title = str(j.title);
    const url = str(j.redirect_url);
    if (!title || !url || j.id == null) continue;
    const created = str(j.created);
    const date = created ? new Date(created) : null;
    const location = str(rec(j.location).display_name);
    out.push({
      source: "adzuna",
      externalId: String(j.id),
      company: str(rec(j.company).display_name) ?? "Unknown",
      title: htmlToText(title), // Adzuna wraps matched words in <strong>
      url,
      description: htmlToText(str(j.description) ?? ""), // only a snippet; the full JD is behind redirect_url
      location,
      remote: /\bremote\b/i.test(`${title} ${location ?? ""}`) ? true : null,
      salaryMin: num(j.salary_min), // Adzuna salaries are already yearly
      salaryMax: num(j.salary_max),
      salaryCurrency: num(j.salary_min) || num(j.salary_max) ? currency : null,
      postedAt: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
      applyPlatform: platformFromUrl(url), // redirect through adzuna.com -> "other" -> manual apply
    });
  }
  return out;
}

export const adzunaSource: JobSource = {
  meta: SOURCE_META.adzuna,
  async fetch(query: SourceQuery, http: HttpGet = defaultHttpGet) {
    const id = process.env.ADZUNA_APP_ID;
    const key = process.env.ADZUNA_APP_KEY;
    if (!id || !key) {
      console.warn("[discovery] adzuna: ADZUNA_APP_ID / ADZUNA_APP_KEY not configured, skipping");
      return [];
    }
    const places = query.locations.length ? query.locations : ["India"];
    const byId = new Map<string, RawJob>();
    let calls = 0;
    for (const place of places) {
      const country = COUNTRIES.find((c) => c.match.test(place)) ?? COUNTRIES[0];
      for (const kw of query.keywords) {
        if (calls >= MAX_CALLS) break;
        calls++;
        const params = new URLSearchParams({
          app_id: id,
          app_key: key,
          what: kw,
          results_per_page: "20",
          max_days_old: "7",
          sort_by: "date",
          "content-type": "application/json",
        });
        if (!/^remote$/i.test(place) && !/^india$/i.test(place)) params.set("where", place);
        const body = await getJson(http, `https://api.adzuna.com/v1/api/jobs/${country.code}/search/1?${params}`);
        if (body) for (const job of mapAdzuna(body, country.currency)) byId.set(job.externalId, job);
      }
    }
    return [...byId.values()];
  },
};
