import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { HttpGet, JobSource, SourceQuery } from "../../src/contracts.js";
import { prisma } from "../../src/db.js";
import { resetDb } from "../helpers/resetDb.js";
import { mapAdzuna } from "../../src/discovery/adzuna.js";
import { mapArbeitnow } from "../../src/discovery/arbeitnow.js";
import { createAshbySource } from "../../src/discovery/ashby.js";
import { createGreenhouseSource } from "../../src/discovery/greenhouse.js";
import { mapHimalayas } from "../../src/discovery/himalayas.js";
import { fetchJobFromUrl, runDiscoveryWith, queryKeyOf, SOURCE_META } from "../../src/discovery/index.js";
import { jsearchSource, mapJSearch } from "../../src/discovery/jsearch.js";
import { titleMatches } from "../../src/discovery/keywords.js";
import { titleCaseSlug, toBoards } from "../../src/discovery/boards.js";
import { createLeverSource } from "../../src/discovery/lever.js";
import { mapRemoteOk } from "../../src/discovery/remoteok.js";
import { mapRemotive } from "../../src/discovery/remotive.js";
import { htmlToText, platformFromUrl, toYearly } from "../../src/discovery/util.js";
import { mapWwr } from "../../src/discovery/weworkremotely.js";

const dir = resolve(import.meta.dirname, "../fixtures/discovery");
const text = (f: string) => readFileSync(resolve(dir, f), "utf8");
const json = (f: string) => JSON.parse(text(f));

// Fake HTTP: url -> body (or status). Records every URL asked for.
function fakeHttp(routes: Record<string, string | number>) {
  const urls: string[] = [];
  const http: HttpGet = async (url) => {
    urls.push(url);
    const hit = routes[url];
    if (hit === undefined) return { status: 404, body: "" };
    return typeof hit === "number" ? { status: hit, body: "" } : { status: 200, body: hit };
  };
  return { http, urls };
}

describe("util", () => {
  it("strips html into readable text", () => {
    expect(htmlToText("<p>Hi&nbsp;<b>there</b> &amp; you</p><ul><li>One</li><li>Two</li></ul>")).toBe("Hi there & you\n\n- One\n- Two");
  });

  it("normalizes salaries to yearly", () => {
    expect(toYearly(50000, "MONTH")).toBe(600000);
    expect(toYearly(50, "per-hour-wage")).toBe(104000);
    expect(toYearly(100000, "per-year-salary")).toBe(100000);
    expect(toYearly(100000, "1 YEAR")).toBe(100000);
    expect(toYearly(100000, null)).toBe(100000);
    expect(toYearly(0, "year")).toBeNull();
    expect(toYearly(5000, "one-time")).toBeNull();
  });

  it("detects the apply platform from the host", () => {
    expect(platformFromUrl("https://job-boards.eu.greenhouse.io/x/jobs/1")).toBe("greenhouse");
    expect(platformFromUrl("https://jobs.lever.co/x/1")).toBe("lever");
    expect(platformFromUrl("https://jobs.ashbyhq.com/x/1")).toBe("ashby");
    expect(platformFromUrl("https://in.indeed.com/viewjob")).toBe("other");
    expect(platformFromUrl("https://notgreenhouse.io/x")).toBe("other");
    expect(platformFromUrl("not a url")).toBe("other");
  });
});

describe("titleMatches", () => {
  it("matches case-insensitively and by synonym", () => {
    expect(titleMatches("Software Engineer II", ["SDE"])).toBe(true);
    expect(titleMatches("SDE 1", ["software engineer"])).toBe(true);
    expect(titleMatches("Fullstack Developer", ["full stack"])).toBe(true);
    expect(titleMatches("Full-Stack Engineer", ["fullstack"])).toBe(true);
    expect(titleMatches("Back End Engineer", ["backend"])).toBe(true);
  });
  it("does not match inside other words, and rejects unrelated titles", () => {
    expect(titleMatches("Insider Risk Analyst", ["sde"])).toBe(false);
    expect(titleMatches("Account Executive", ["software engineer"])).toBe(false);
  });
  it("no keywords = no filter", () => {
    expect(titleMatches("Anything", [])).toBe(true);
  });
});

describe("adapters on saved fixtures", () => {
  it("remotive", () => {
    const jobs = mapRemotive(json("remotive.json"), ["software engineer"]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ source: "remotive", company: "Askable", remote: true, applyPlatform: "other" });
    expect(jobs[0].description).not.toContain("<");
    expect(jobs[0].postedAt).toMatch(/^2026-10-17T16:04:29/);
  });

  it("remoteok skips the legal notice and treats 0 salary as unknown", () => {
    const all = mapRemoteOk(json("remoteok.json"), []);
    expect(all).toHaveLength(3); // legal notice dropped
    expect(all.every((j) => j.salaryMin === null && j.salaryCurrency === null)).toBe(true);
    expect(mapRemoteOk(json("remoteok.json"), ["backend"]).map((j) => j.title)).toEqual(["Senior Backend Engineer"]);
  });

  it("himalayas maps salary", () => {
    const jobs = mapHimalayas(json("himalayas.json"), ["data engineer"]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].salaryMin).toBe(80000);
    expect(jobs[0].remote).toBe(true);
  });

  it("arbeitnow keeps the remote flag", () => {
    const jobs = mapArbeitnow(json("arbeitnow.json"), ["security engineer"]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].remote).toBe(true);
    expect(jobs[0].postedAt).not.toBeNull();
  });

  it("weworkremotely splits 'Company: Role' from RSS", () => {
    const jobs = mapWwr(text("weworkremotely.xml"), ["software engineer"]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ company: "Yooli", source: "weworkremotely", remote: true });
    expect(jobs[0].title).toContain("Software Engineer");
    expect(jobs[0].description).not.toContain("&lt;");
    expect(mapWwr(text("weworkremotely.xml"), [])).toHaveLength(3);
  });

  it("jsearch prefers a direct Greenhouse link and normalizes monthly pay", () => {
    const jobs = mapJSearch(json("jsearch.json"));
    expect(jobs[0]).toMatchObject({
      applyPlatform: "greenhouse",
      url: "https://boards.greenhouse.io/acme/jobs/123",
      salaryMin: 600000,
      salaryMax: 960000,
      salaryCurrency: "INR",
      location: "Bengaluru, Karnataka, IN",
    });
    expect(jobs[1]).toMatchObject({ applyPlatform: "other", remote: true, salaryMin: null });
  });

  it("adzuna strips <strong> tags and keeps yearly salary", () => {
    const jobs = mapAdzuna(json("adzuna.json"), "INR");
    expect(jobs[0]).toMatchObject({ title: "Junior Software Engineer", salaryMin: 600000, salaryCurrency: "INR" });
    expect(jobs[0].description).toBe("Work on our Node services & APIs...");
    expect(jobs[1]).toMatchObject({ remote: true, salaryCurrency: null });
  });

  it("greenhouse decodes the escaped html and filters by keyword", async () => {
    const { http } = fakeHttp({
      "https://boards-api.greenhouse.io/v1/boards/groww/jobs?content=true": text("greenhouse.json"),
      "https://boards-api.greenhouse.io/v1/boards/gone/jobs?content=true": 404, // a dead board must not abort the run
    });
    const src = createGreenhouseSource({ companies: ["gone", "groww"], pauseMs: 0 });
    const jobs = await src.fetch({ keywords: ["content"], locations: [] }, http);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ source: "greenhouse", company: "Groww", applyPlatform: "greenhouse", location: "Bengaluru-VTP, India" });
    expect(jobs[0].description).not.toContain("&lt;");
    expect(jobs[0].description).not.toContain("<div>");
  });

  it("lever reads createdAt (ms) and workplaceType", async () => {
    const { http } = fakeHttp({ "https://api.lever.co/v0/postings/meesho?mode=json": text("lever.json") });
    const jobs = await createLeverSource({ companies: ["meesho"], pauseMs: 0 }).fetch({ keywords: ["manager"], locations: [] }, http);
    expect(jobs.map((j) => j.title)).toEqual(["AM/ Manager - Risk & Decision Science", "Assistant Manager - Business Finance"]);
    expect(jobs[0]).toMatchObject({ applyPlatform: "lever", remote: false });
    expect(jobs[0].postedAt).toBe("2025-09-15T06:02:29.833Z");
  });

  it("lever salaryRange is normalized to yearly", async () => {
    const posting = {
      id: "p1", text: "SDE", hostedUrl: "https://jobs.lever.co/x/p1", workplaceType: "remote",
      descriptionPlain: "d", createdAt: 1757916149833,
      salaryRange: { currency: "USD", interval: "per-hour-wage", min: 40, max: 50 },
    };
    const { http } = fakeHttp({ "https://api.lever.co/v0/postings/x?mode=json": JSON.stringify([posting]) });
    const [job] = await createLeverSource({ companies: ["x"], pauseMs: 0 }).fetch({ keywords: ["software engineer"], locations: [] }, http);
    expect(job).toMatchObject({ salaryMin: 83200, salaryMax: 104000, salaryCurrency: "USD", remote: true });
  });

  it("ashby reads compensation summaryComponents", async () => {
    const board = {
      jobs: [
        {
          id: "a1", title: "Backend Engineer", jobUrl: "https://jobs.ashbyhq.com/x/a1", isListed: true, isRemote: true,
          location: "Remote", descriptionPlain: "plain", publishedAt: "2026-10-01T00:00:00.000+00:00",
          compensation: { summaryComponents: [{ compensationType: "Salary", interval: "1 YEAR", currencyCode: "USD", minValue: 120000, maxValue: 150000 }] },
        },
        { id: "a2", title: "Unlisted Engineer", jobUrl: "https://jobs.ashbyhq.com/x/a2", isListed: false },
      ],
    };
    const { http } = fakeHttp({ "https://api.ashbyhq.com/posting-api/job-board/x?includeCompensation=true": JSON.stringify(board) });
    const jobs = await createAshbySource({ companies: ["x"], pauseMs: 0 }).fetch({ keywords: ["backend"], locations: [] }, http);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ salaryMin: 120000, salaryMax: 150000, salaryCurrency: "USD", remote: true, company: "X" });
  });

  it("jsearch without a key is skipped, not a crash", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const saved = process.env.RAPIDAPI_KEY;
    delete process.env.RAPIDAPI_KEY;
    const { http, urls } = fakeHttp({});
    expect(await jsearchSource.fetch({ keywords: ["sde"], locations: [] }, http)).toEqual([]);
    expect(urls).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("not configured"));
    if (saved) process.env.RAPIDAPI_KEY = saved;
    warn.mockRestore();
  });
});

describe("company display names", () => {
  it("entries can be a slug or { token, name }; the slug is title-cased otherwise", () => {
    expect(titleCaseSlug("sarvam")).toBe("Sarvam");
    expect(titleCaseSlug("my-co_x")).toBe("My Co X");
    expect(toBoards(["supabase", { token: "acme", name: "Acme Labs" }, { token: "beta-co" }])).toEqual([
      { token: "supabase", name: "Supabase" },
      { token: "acme", name: "Acme Labs" },
      { token: "beta-co", name: "Beta Co" },
    ]);
  });

  it("ashby and lever jobs carry the display name, not the slug", async () => {
    const board = { jobs: [{ id: "a1", title: "Backend Engineer", jobUrl: "https://jobs.ashbyhq.com/x/a1", isListed: true }] };
    const a = fakeHttp({ "https://api.ashbyhq.com/posting-api/job-board/supabase?includeCompensation=true": JSON.stringify(board) });
    const [aj] = await createAshbySource({ companies: ["supabase"], pauseMs: 0 }).fetch({ keywords: [], locations: [] }, a.http);
    expect(aj.company).toBe("Supabase");

    const posting = { id: "p1", text: "SDE", hostedUrl: "https://jobs.lever.co/x/p1", descriptionPlain: "d" };
    const l = fakeHttp({ "https://api.lever.co/v0/postings/meesho?mode=json": JSON.stringify([posting]) });
    const [lj] = await createLeverSource({ companies: [{ token: "meesho", name: "Meesho Ltd" }], pauseMs: 0 }).fetch({ keywords: [], locations: [] }, l.http);
    expect(lj.company).toBe("Meesho Ltd");
  });
});

describe("fetchJobFromUrl", () => {
  it("greenhouse (eu job-boards host)", async () => {
    const single = json("greenhouse.json").jobs[0];
    const { http, urls } = fakeHttp({ "https://boards-api.greenhouse.io/v1/boards/groww/jobs/4970739101": JSON.stringify(single) });
    const job = await fetchJobFromUrl("https://job-boards.eu.greenhouse.io/groww/jobs/4970739101", http);
    expect(job?.title).toBe("Assistant Manager - Internal Audit");
    expect(urls).toHaveLength(1);
  });

  it("lever", async () => {
    const single = json("lever.json")[0];
    const { http } = fakeHttp({ [`https://api.lever.co/v0/postings/meesho/${single.id}`]: JSON.stringify(single) });
    const job = await fetchJobFromUrl(`https://jobs.lever.co/meesho/${single.id}`, http);
    expect(job).toMatchObject({ source: "lever", externalId: single.id });
  });

  it("ashby picks the id out of the board", async () => {
    const board = json("ashby.json");
    const { http } = fakeHttp({ "https://api.ashbyhq.com/posting-api/job-board/supabase?includeCompensation=true": JSON.stringify(board) });
    const job = await fetchJobFromUrl(board.jobs[1].jobUrl, http);
    expect(job?.title).toBe("Customer Solution Architect (AMER)");
  });

  it("unknown hosts, bad URLs and missing postings give null", async () => {
    const { http } = fakeHttp({});
    expect(await fetchJobFromUrl("https://example.com/jobs/1", http)).toBeNull();
    expect(await fetchJobFromUrl("nonsense", http)).toBeNull();
    expect(await fetchJobFromUrl("https://boards.greenhouse.io/acme/jobs/999", http)).toBeNull();
  });
});

describe("runDiscoveryWith (rate guard)", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  const query: SourceQuery = { keywords: ["SDE"], locations: ["India"] };
  function fakeSource(counter: { n: number }): JobSource {
    return {
      meta: SOURCE_META.remotive,
      async fetch() {
        counter.n++;
        return [
          { source: "remotive", externalId: "1", company: "A", title: "SDE", url: "u", description: "d", location: null, remote: true, salaryMin: null, salaryMax: null, salaryCurrency: null, postedAt: null, applyPlatform: "other" },
        ];
      },
    };
  }

  it("skips a source fetched within its minimum interval, then fetches again after it", async () => {
    const counter = { n: 0 };
    const sources = { remotive: fakeSource(counter) };
    const t0 = new Date("2026-10-21T00:00:00Z");

    expect(await runDiscoveryWith(query, ["remotive"], { sources, now: () => t0 })).toHaveLength(1);
    // 10 minutes later: blocked (remotive min interval is 360)
    expect(await runDiscoveryWith(query, ["remotive"], { sources, now: () => new Date(t0.getTime() + 10 * 60_000) })).toEqual([]);
    expect(counter.n).toBe(1);
    // 7 hours later: allowed
    await runDiscoveryWith(query, ["remotive"], { sources, now: () => new Date(t0.getTime() + 7 * 3_600_000) });
    expect(counter.n).toBe(2);
  });

  it("a different query is not blocked, and key order does not matter", async () => {
    expect(queryKeyOf({ keywords: ["a", "B"], locations: [] })).toBe(queryKeyOf({ keywords: ["b", "A"], locations: [] }));
    const counter = { n: 0 };
    const sources = { remotive: fakeSource(counter) };
    await runDiscoveryWith(query, ["remotive"], { sources });
    await runDiscoveryWith({ keywords: ["react"], locations: [] }, ["remotive"], { sources });
    expect(counter.n).toBe(2);
  });

  it("one failing source does not stop the others", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const counter = { n: 0 };
    const boom: JobSource = { meta: SOURCE_META.remoteok, fetch: async () => { throw new Error("boom"); } };
    const jobs = await runDiscoveryWith(query, ["remoteok", "remotive"], { sources: { remoteok: boom, remotive: fakeSource(counter) } });
    expect(jobs).toHaveLength(1);
    warn.mockRestore();
  });

  it("skips a keyed source whose key is missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    delete process.env.ADZUNA_APP_ID;
    const counter = { n: 0 };
    await runDiscoveryWith(query, ["adzuna"], { sources: { adzuna: { ...fakeSource(counter), meta: SOURCE_META.adzuna } } });
    expect(counter.n).toBe(0);
    warn.mockRestore();
  });
});

describe("SOURCE_META", () => {
  it("has an entry for every source, with attribution where the ToS requires it", () => {
    for (const id of ["remotive", "remoteok", "himalayas", "arbeitnow", "weworkremotely", "adzuna"] as const) {
      expect(SOURCE_META[id].attribution).toBeTruthy();
    }
    expect(SOURCE_META.jsearch.minIntervalMinutes).toBeGreaterThanOrEqual(720);
  });
});
