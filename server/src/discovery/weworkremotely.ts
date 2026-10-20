import { XMLParser } from "fast-xml-parser";
import type { HttpGet, JobSource, RawJob, SourceQuery } from "../contracts.js";
import { titleMatches } from "./keywords.js";
import { SOURCE_META } from "./meta.js";
import { arr, defaultHttpGet, htmlToText, platformFromUrl, rec, str } from "./util.js";

const FEEDS = [
  "https://weworkremotely.com/categories/remote-programming-jobs.rss",
  "https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss",
];

const parser = new XMLParser({ ignoreAttributes: true, processEntities: true });

export function mapWwr(xml: string, keywords: string[]): RawJob[] {
  const parsed = rec(parser.parse(xml));
  const items = arr(rec(rec(parsed.rss).channel).item);
  const out: RawJob[] = [];
  for (const raw of items) {
    const j = rec(raw);
    const full = str(j.title);
    const url = str(j.link) ?? str(j.guid);
    if (!full || !url) continue;
    // Titles look like "Company: Role"
    const idx = full.indexOf(":");
    const company = idx > 0 ? full.slice(0, idx).trim() : "Unknown";
    const title = idx > 0 ? full.slice(idx + 1).trim() : full;
    if (!titleMatches(title, keywords)) continue;
    const posted = str(j.pubDate);
    const date = posted ? new Date(posted) : null;
    out.push({
      source: "weworkremotely",
      externalId: str(j.guid) ?? url,
      company,
      title,
      url,
      description: htmlToText(str(j.description) ?? ""),
      location: str(j.region),
      remote: true,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      postedAt: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
      applyPlatform: platformFromUrl(url),
    });
  }
  return out;
}

export const weWorkRemotelySource: JobSource = {
  meta: SOURCE_META.weworkremotely,
  async fetch(query: SourceQuery, http: HttpGet = defaultHttpGet) {
    const byId = new Map<string, RawJob>();
    for (const feed of FEEDS) {
      try {
        const res = await http(feed, { Accept: "application/rss+xml, application/xml" });
        if (res.status !== 200) {
          console.warn(`[discovery] ${feed} -> HTTP ${res.status}`);
          continue;
        }
        for (const job of mapWwr(res.body, query.keywords)) byId.set(job.externalId, job);
      } catch (err) {
        console.warn(`[discovery] ${feed} failed: ${(err as Error).message}`);
      }
    }
    return [...byId.values()];
  },
};
