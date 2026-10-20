import { describe, it, expect } from "vitest";
import { applyFilters, dedupeKey, parseSalaryText, passesThreshold, toYearly } from "../../src/filters/index.js";
import { checkNotice } from "../../src/filters/notice.js";
import { maxYearsRequired, seniorTitleWord } from "../../src/filters/seniority.js";
import type { FilterSettings } from "../../src/contracts.js";

const settings: FilterSettings = {
  salaryFloors: { INR: 1_200_000, USD: 30_000 },
  noticeDays: 60,
  matchThreshold: 65,
  maxYearsRequired: 2,
};
const base = {
  title: "Software Engineer",
  description: "Build things.",
  location: "Bengaluru",
  remote: null,
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
};

describe("salary", () => {
  it("normalizes to yearly", () => {
    expect(toYearly(50, "hour")).toBe(104_000);
    expect(toYearly(80_000, "month")).toBe(960_000);
    expect(toYearly(12, "lpa")).toBe(1_200_000);
  });
  it("parses text", () => {
    expect(parseSalaryText("12 LPA")).toBe(1_200_000);
    expect(parseSalaryText("15 lakh")).toBe(1_500_000);
    expect(parseSalaryText("$50/hr")).toBe(104_000);
    expect(parseSalaryText("80,000 per month")).toBe(960_000);
    expect(parseSalaryText("competitive")).toBeNull();
    expect(parseSalaryText("50000")).toBeNull();
  });
  it("drops when max is below floor", () => {
    const r = applyFilters({ ...base, salaryMin: 400_000, salaryMax: 800_000, salaryCurrency: "INR" }, settings);
    expect(r.keep).toBe(false);
    expect(r.reasons[0]).toMatch(/below/);
  });
  it("keeps when max reaches floor even if min is below", () => {
    const r = applyFilters({ ...base, salaryMin: 800_000, salaryMax: 1_500_000, salaryCurrency: "INR" }, settings);
    expect(r.keep).toBe(true);
    expect(r.tags).not.toContain("salary_unknown");
  });
  it("uses min when there is no max", () => {
    const r = applyFilters({ ...base, salaryMin: 20_000, salaryCurrency: "usd" }, settings);
    expect(r.keep).toBe(false);
  });
  it("unknown salary or currency keeps and tags", () => {
    expect(applyFilters(base, settings)).toMatchObject({ keep: true, tags: ["salary_unknown"] });
    const r = applyFilters({ ...base, salaryMax: 1, salaryCurrency: "JPY" }, settings);
    expect(r).toMatchObject({ keep: true, tags: ["salary_unknown"] });
  });
  it("loop floors override settings", () => {
    const job = { ...base, salaryMax: 1_500_000, salaryCurrency: "INR" };
    expect(applyFilters(job, settings, { salaryFloors: { INR: 2_000_000 } }).keep).toBe(false);
  });
});

describe("notice", () => {
  it("drops immediate joiners", () => {
    expect(checkNotice("We need Immediate Joiners only", 60).drop).toBeTruthy();
    expect(checkNotice("immediate joiner preferred", 60).drop).toBeTruthy();
  });
  it("drops short join windows", () => {
    expect(checkNotice("Must join within 30 days", 60).drop).toBeTruthy();
    expect(checkNotice("joining within 2 weeks", 60).drop).toBeTruthy();
    expect(checkNotice("join in 1 month", 60).drop).toBeTruthy();
  });
  it("keeps windows >= my notice", () => {
    expect(checkNotice("join within 60 days", 60).drop).toBeNull();
    expect(checkNotice("join within 3 months", 60).drop).toBeNull();
    expect(checkNotice("join within 9 weeks", 60).drop).toBeNull();
  });
  it("drops capped notice period", () => {
    expect(checkNotice("Notice period of max 30 days", 60).drop).toBeTruthy();
    expect(checkNotice("notice period up to 15 days", 60).drop).toBeTruthy();
    expect(checkNotice("Max 30 days notice", 60).drop).toBeTruthy();
    expect(checkNotice("Notice period of max 90 days", 60).drop).toBeNull();
  });
  it("flexible immediate start is only a risk tag", () => {
    const r = applyFilters({ ...base, description: "Immediate start preferred but flexible." }, settings);
    expect(r.keep).toBe(true);
    expect(r.tags).toContain("notice_risk");
  });
  it("plain JD has no notice flags", () => {
    expect(checkNotice("Build APIs", 60)).toEqual({ drop: null, risk: false });
  });
});

describe("seniority", () => {
  it.each([
    "Senior Engineer",
    "Sr. Developer",
    "Staff Engineer",
    "Principal Engineer",
    "Tech Lead",
    "Head of Engineering",
    "Director of IT",
    "Engineering Manager",
    "SENIOR dev",
  ])("drops %s", (title) => {
    expect(applyFilters({ ...base, title }, settings).keep).toBe(false);
  });
  it.each(["Software Engineer", "Leadership Program Associate", "Headless CMS Developer", "Junior Developer"])(
    "keeps %s",
    (title) => {
      expect(seniorTitleWord(title)).toBeNull();
    },
  );
  it("tags N+ years above the limit but keeps", () => {
    const r = applyFilters({ ...base, description: "Requires 5+ years of experience" }, settings);
    expect(r.keep).toBe(true);
    expect(r.tags).toContain("seniority_risk");
  });
  it("does not tag within the limit", () => {
    expect(applyFilters({ ...base, description: "1+ years experience" }, settings).tags).not.toContain(
      "seniority_risk",
    );
  });
  it("reads ranges and 'at least'", () => {
    expect(maxYearsRequired("3-5 years")).toBe(3);
    expect(maxYearsRequired("at least 4 years of Node")).toBe(4);
    expect(maxYearsRequired("no experience needed")).toBeNull();
  });
});

describe("loop filters", () => {
  it("remoteOnly drops non-remote, keeps remote, tags unknown", () => {
    const loop = { remoteOnly: true };
    expect(applyFilters({ ...base, remote: false }, settings, loop).keep).toBe(false);
    expect(applyFilters({ ...base, remote: true }, settings, loop).keep).toBe(true);
    expect(applyFilters({ ...base, remote: null }, settings, loop).tags).toContain("remote_unknown");
    expect(applyFilters({ ...base, remote: null, location: "Remote - India" }, settings, loop).tags).not.toContain(
      "remote_unknown",
    );
  });
  it("excludeKeywords matches whole words in the title", () => {
    const loop = { excludeKeywords: ["intern", "c++"] };
    expect(applyFilters({ ...base, title: "Software Intern" }, settings, loop).keep).toBe(false);
    expect(applyFilters({ ...base, title: "Internal Tools Engineer" }, settings, loop).keep).toBe(true);
    expect(applyFilters({ ...base, title: "C++ Developer" }, settings, loop).keep).toBe(false);
  });
  it("collects every reason", () => {
    const r = applyFilters({ ...base, title: "Senior Dev", description: "immediate joiners" }, settings);
    expect(r.reasons).toHaveLength(2);
  });
});

describe("passesThreshold", () => {
  it("uses settings threshold by default", () => {
    expect(passesThreshold(65, settings)).toBe(true);
    expect(passesThreshold(64, settings)).toBe(false);
  });
  it("loop minScore overrides", () => {
    expect(passesThreshold(70, settings, { minScore: 80 })).toBe(false);
    expect(passesThreshold(50, settings, { minScore: 40 })).toBe(true);
  });
});

describe("dedupeKey", () => {
  it("ignores case, punctuation, query, trailing slash and protocol", () => {
    const a = dedupeKey("Acme, Inc.", "Backend  Engineer!", "https://Boards.example.com/acme/jobs/1/?utm=x#a");
    const b = dedupeKey("acme inc", "backend engineer", "http://boards.example.com/acme/jobs/1");
    expect(a).toBe(b);
  });
  it("differs for different urls", () => {
    expect(dedupeKey("A", "B", "https://x.com/1")).not.toBe(dedupeKey("A", "B", "https://x.com/2"));
  });
  it("handles missing url", () => {
    expect(dedupeKey("A", "B", null)).toBe("a|b|");
  });
});
