import type { SourceId, SourceMeta } from "../contracts.js";

// Facts from each source's own docs/ToS (checked 2026-10-21, see docs/DECISIONS.md).
// minIntervalMinutes is our own floor: never fetch the same query more often than this.
export const SOURCE_META: Record<SourceId, SourceMeta> = {
  manual: { id: "manual", label: "Pasted", minIntervalMinutes: 0, attribution: null, needsKey: null },
  jsearch: {
    id: "jsearch",
    label: "JSearch (RapidAPI)",
    minIntervalMinutes: 720, // free plan is ~200 requests/month, so 2 runs a day at most
    attribution: null,
    needsKey: "RAPIDAPI_KEY",
  },
  adzuna: {
    id: "adzuna",
    label: "Adzuna",
    minIntervalMinutes: 360,
    attribution: "Jobs by Adzuna (link back to adzuna.com)",
    needsKey: "ADZUNA_APP_ID",
  },
  remotive: {
    id: "remotive",
    label: "Remotive",
    minIntervalMinutes: 360, // their docs: max 4 requests/day, blocked above 2/minute
    attribution: "Source: Remotive (link to the Remotive listing)",
    needsKey: null,
  },
  remoteok: {
    id: "remoteok",
    label: "Remote OK",
    minIntervalMinutes: 360,
    attribution: "Source: Remote OK (followed link back to the Remote OK listing)",
    needsKey: null,
  },
  himalayas: {
    id: "himalayas",
    label: "Himalayas",
    minIntervalMinutes: 720, // their data refreshes daily
    attribution: "Source: Himalayas (link back to himalayas.app)",
    needsKey: null,
  },
  arbeitnow: {
    id: "arbeitnow",
    label: "Arbeitnow",
    minIntervalMinutes: 360,
    attribution: "Source: Arbeitnow",
    needsKey: null,
  },
  weworkremotely: {
    id: "weworkremotely",
    label: "We Work Remotely",
    minIntervalMinutes: 360, // RSS ttl is 60 min
    attribution: "Source: We Work Remotely",
    needsKey: null,
  },
  greenhouse: { id: "greenhouse", label: "Greenhouse boards", minIntervalMinutes: 120, attribution: null, needsKey: null },
  lever: { id: "lever", label: "Lever boards", minIntervalMinutes: 120, attribution: null, needsKey: null },
  ashby: { id: "ashby", label: "Ashby boards", minIntervalMinutes: 120, attribution: null, needsKey: null },
};
