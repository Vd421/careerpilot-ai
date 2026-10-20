import type { HttpGet, JobSource, RawJob, RunDiscovery, SourceId, SourceQuery } from "../contracts.js";
import { prisma } from "../db.js";
import { adzunaSource } from "./adzuna.js";
import { arbeitnowSource } from "./arbeitnow.js";
import { ashbySource } from "./ashby.js";
import { greenhouseSource } from "./greenhouse.js";
import { himalayasSource } from "./himalayas.js";
import { jsearchSource } from "./jsearch.js";
import { leverSource } from "./lever.js";
import { SOURCE_META } from "./meta.js";
import { remoteOkSource } from "./remoteok.js";
import { remotiveSource } from "./remotive.js";
import { weWorkRemotelySource } from "./weworkremotely.js";

export { SOURCE_META } from "./meta.js";
export { fetchJobFromUrl } from "./fromUrl.js";
export { titleMatches } from "./keywords.js";

export const SOURCES: Partial<Record<SourceId, JobSource>> = {
  jsearch: jsearchSource,
  adzuna: adzunaSource,
  remotive: remotiveSource,
  remoteok: remoteOkSource,
  himalayas: himalayasSource,
  arbeitnow: arbeitnowSource,
  weworkremotely: weWorkRemotelySource,
  greenhouse: greenhouseSource,
  lever: leverSource,
  ashby: ashbySource,
};

export interface DiscoveryDeps {
  http?: HttpGet;
  sources?: Partial<Record<SourceId, JobSource>>; // tests inject fakes
  now?: () => Date;
}

// Same keywords + locations in any order = same key.
export function queryKeyOf(query: SourceQuery): string {
  const norm = (xs: string[]) => xs.map((x) => x.trim().toLowerCase()).sort().join(",");
  return `k=${norm(query.keywords)};l=${norm(query.locations)}`;
}

// Rate guard: true if this source+query was fetched within the source's minimum interval.
async function fetchedRecently(source: SourceId, queryKey: string, now: Date): Promise<boolean> {
  const minutes = SOURCE_META[source].minIntervalMinutes;
  if (minutes <= 0) return false;
  const since = new Date(now.getTime() - minutes * 60_000);
  const hit = await prisma.sourceFetch.findFirst({ where: { source, queryKey, fetchedAt: { gte: since } } });
  return hit !== null;
}

export async function runDiscoveryWith(query: SourceQuery, sources: SourceId[], deps: DiscoveryDeps = {}): Promise<RawJob[]> {
  const registry = deps.sources ?? SOURCES;
  const now = deps.now?.() ?? new Date();
  const queryKey = queryKeyOf(query);
  const seen = new Map<string, RawJob>();

  for (const id of sources) {
    const adapter = registry[id];
    if (!adapter) continue; // "manual" has no adapter
    const keyEnv = SOURCE_META[id].needsKey;
    if (keyEnv && !process.env[keyEnv]) {
      console.warn(`[discovery] ${id}: ${keyEnv} not configured, skipping`);
      continue;
    }
    if (await fetchedRecently(id, queryKey, now)) {
      console.info(`[discovery] ${id}: fetched within ${SOURCE_META[id].minIntervalMinutes} min, skipping`);
      continue;
    }
    try {
      const jobs = await adapter.fetch(query, deps.http);
      // Record AFTER the call so a crash doesn't block the retry, but BEFORE the next source.
      await prisma.sourceFetch.create({ data: { source: id, queryKey, count: jobs.length, fetchedAt: now } });
      for (const job of jobs) seen.set(`${job.source}:${job.externalId}`, job);
    } catch (err) {
      console.warn(`[discovery] ${id} failed: ${(err as Error).message}`);
    }
  }
  return [...seen.values()];
}

export const runDiscovery: RunDiscovery = (query, sources) => runDiscoveryWith(query, sources);
