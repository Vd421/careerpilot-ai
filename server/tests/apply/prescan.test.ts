import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser } from "playwright";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { formUrlFor, prescanUrl, standardKeyOf } from "../../src/apply/prescan.js";

// Real Chromium on saved HTML files (file://). Set SKIP_BROWSER_TESTS=1 to skip.
const skip = process.env.SKIP_BROWSER_TESTS === "1";
const fixture = (name: string) => pathToFileURL(resolve(import.meta.dirname, "../fixtures/forms", name)).href;

describe.skipIf(skip)("prescan on saved form pages", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser.close();
  });
  const scan = (file: string, platform: "greenhouse" | "lever" | "ashby") => prescanUrl(fixture(file), platform, { browser, formWaitMs: 800 });

  it("greenhouse: standard fields get fixed keys, custom questions keep their text", async () => {
    const r = await scan("greenhouse.html", "greenhouse");
    // The page loads an invisible reCAPTCHA badge like every Greenhouse page: NOT a blocker.
    expect(r).toMatchObject({ ok: true, blocker: null });
    const byKey = Object.fromEntries(r.fields.map((f) => [standardKeyOf(f) ?? f.name, f]));
    expect(byKey.first_name).toMatchObject({ name: "first_name", required: true, type: "text" });
    expect(byKey.email.required).toBe(true);
    expect(byKey.resume).toMatchObject({ type: "file", required: true });
    expect(byKey.linkedin.required).toBe(false);
    const relative = r.fields.find((f) => f.label.startsWith("Do you have a relative"));
    expect(relative).toMatchObject({ type: "select", required: true });
    expect(r.fields.find((f) => f.name === "candidate-location")).toMatchObject({ type: "text", required: true });
    // "capacity" contains "city": must not be mistaken for the city autocomplete
    expect(r.fields.find((f) => f.label.startsWith("Have you previously been employed"))?.type).toBe("select");
  });

  it("lever: reads li.application-question blocks, radios with options, ignores the autofill widget", async () => {
    const r = await scan("lever.html", "lever");
    expect(r.ok).toBe(true);
    const keys = r.fields.map((f) => standardKeyOf(f));
    expect(keys).toEqual(expect.arrayContaining(["resume", "full_name", "email", "phone", "linkedin", "github", "website"]));
    const relocate = r.fields.find((f) => f.label.startsWith("Are you willing to relocate"));
    expect(relocate).toMatchObject({ type: "radio", required: true, options: ["Yes", "No", "Not Applicable"] });
    const notice = r.fields.find((f) => f.label.startsWith("Notice Period"));
    expect(notice).toMatchObject({ type: "text", required: true });
    expect(r.fields.find((f) => f.name === "urls[Naukri]")?.required).toBe(false);
    expect(r.fields.every((f) => f.name !== "h-captcha-response")).toBe(true);
  });

  it("lever: hidden hCaptcha overlay (visibility:hidden) is not a blocker", async () => {
    expect((await scan("lever.html", "lever")).blocker).toBeNull();
  });

  it("ashby: reads field entries, yes/no buttons as radio, system fields", async () => {
    const r = await scan("ashby.html", "ashby");
    expect(r).toMatchObject({ ok: true, blocker: null });
    expect(r.fields.find((f) => f.name === "_systemfield_name")).toMatchObject({ required: true });
    expect(standardKeyOf(r.fields.find((f) => f.name === "_systemfield_resume")!)).toBe("resume");
    expect(r.fields.find((f) => f.label === "Are you over the age of 18?")).toMatchObject({ type: "radio", options: ["Yes", "No"], required: true });
    expect(r.fields.find((f) => f.label.startsWith("Tell us about your experience"))?.type).toBe("textarea");
    expect(r.fields.find((f) => f.label === "Twitter / X profile")?.required).toBe(false);
  });

  it("a visible captcha blocks with 'captcha' (fields are still returned)", async () => {
    const r = await scan("synthetic-captcha.html", "greenhouse");
    expect(r).toMatchObject({ ok: false, blocker: "captcha" });
    expect(r.fields.length).toBeGreaterThan(0);
  });

  it("login wall and missing form give unknown_form", async () => {
    expect(await scan("synthetic-login.html", "greenhouse")).toMatchObject({ ok: false, blocker: "unknown_form" });
    expect(await scan("synthetic-unknown.html", "lever")).toMatchObject({ ok: false, blocker: "unknown_form" });
  });

  it("an unreachable page gives unknown_form instead of throwing", async () => {
    const r = await prescanUrl(pathToFileURL(resolve(import.meta.dirname, "../fixtures/forms/nope.html")).href, "greenhouse", { browser });
    expect(r).toMatchObject({ ok: false, blocker: "unknown_form" });
  });

  it("reads options by opening custom dropdowns; type-ahead and huge lists stay without options", async () => {
    const r = await scan("synthetic-menus.html", "greenhouse");
    const visa = r.fields.find((f) => f.name === "q1");
    expect(visa).toMatchObject({ type: "select", required: true, options: ["Yes", "No"] });
    expect(r.fields.find((f) => f.name === "q2")).toMatchObject({ type: "text", options: [] }); // "city" = type-ahead
    expect(r.fields.find((f) => f.name === "q3")).toMatchObject({ type: "select", options: [] }); // 120 countries: too many
  });
});

describe("prescan without a browser", () => {
  it("platform 'other' is unsupported_platform and never starts Chromium", async () => {
    expect(await prescanUrl("https://example.com/job", "other")).toEqual({ ok: false, fields: [], blocker: "unsupported_platform" });
  });
});

describe("standardKeyOf / formUrlFor", () => {
  it("maps names and labels to standard keys", () => {
    const k = (name: string, label: string, type: "text" | "file" = "text") => standardKeyOf({ name, label, type });
    expect(k("first_name", "First Name")).toBe("first_name");
    expect(k("name", "Full name")).toBe("full_name");
    expect(k("phone", "Phone")).toBe("phone");
    expect(k("country", "Country")).toBe("phone_country");
    expect(k("resume", "Resume/CV", "file")).toBe("resume");
    expect(k("cover_letter", "Cover Letter", "file")).toBe("cover_letter");
    expect(k("urls[LinkedIn]", "LinkedIn URL")).toBe("linkedin");
    expect(k("q1", "Please mention your portfolio link")).toBe("website");
    expect(k("q2", "Why do you want to work here?")).toBeNull();
    expect(k("q3", "Current location")).toBeNull();
  });

  it("points at the form page for each platform", () => {
    expect(formUrlFor("https://jobs.lever.co/meesho/abc", "lever")).toBe("https://jobs.lever.co/meesho/abc/apply");
    expect(formUrlFor("https://jobs.lever.co/meesho/abc/apply?lever-source=x", "lever")).toBe("https://jobs.lever.co/meesho/abc/apply");
    expect(formUrlFor("https://jobs.ashbyhq.com/x/abc", "ashby")).toBe("https://jobs.ashbyhq.com/x/abc/application");
    expect(formUrlFor("https://job-boards.greenhouse.io/x/jobs/1", "greenhouse")).toBe("https://job-boards.greenhouse.io/x/jobs/1");
    expect(formUrlFor("file:///tmp/form.html", "lever")).toBe("file:///tmp/form.html");
  });
});
