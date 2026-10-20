import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createFormFiller } from "../../src/apply/filler.js";
import { prescanUrl } from "../../src/apply/prescan.js";

// Real Chromium against a local page that behaves like a Greenhouse form (never a real site).
const skip = process.env.SKIP_BROWSER_TESTS === "1";
const page = (hash = "") => pathToFileURL(resolve(import.meta.dirname, "../fixtures/forms/synthetic-fill.html")).href + hash;

const answers = {
  first_name: "Asha",
  last_name: "Example",
  email: "asha@example.com",
  q_sponsor: "No",
  q_reloc: "Yes",
  q_consent: "yes",
  q_why: "I like the product.",
};

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "filler-"));
  const pdf = join(dir, "resume.pdf");
  writeFileSync(pdf, "%PDF-fake");
  return { pdf, shot: join(dir, "shots", "1.png") };
}

describe.skipIf(skip)("createFormFiller (real browser, local page)", () => {
  it("fills text, dropdown, radio, checkbox, textarea and the resume, takes a screenshot, and does NOT submit", async () => {
    const { pdf, shot } = setup();
    const filler = createFormFiller({ formWaitMs: 800 });
    const res = await filler.fill({ url: page(), platform: "greenhouse", answers, resumePdfPath: pdf, submit: false, screenshotPath: shot });
    expect(res).toMatchObject({ ok: true, submitted: false, blocker: null, error: null });
    expect(existsSync(shot)).toBe(true);
    expect(res.screenshotPath).toBe(shot);
  });

  it("submit=true clicks submit and recognizes the confirmation page", async () => {
    const { pdf, shot } = setup();
    const filler = createFormFiller({ formWaitMs: 800, confirmWaitMs: 5000 });
    const res = await filler.fill({ url: page(), platform: "greenhouse", answers, resumePdfPath: pdf, submit: true, screenshotPath: shot });
    expect(res).toMatchObject({ ok: true, submitted: true });
    expect(existsSync(shot)).toBe(true);
  });

  it("allowSubmit=false refuses to submit at all", async () => {
    const { pdf } = setup();
    const filler = createFormFiller({ allowSubmit: false });
    await expect(filler.fill({ url: page(), platform: "greenhouse", answers, resumePdfPath: pdf, submit: true })).rejects.toThrow(/allowSubmit=false/);
  });

  it("no confirmation after the click -> submitted false with an error (caller goes manual)", async () => {
    const { pdf, shot } = setup();
    const filler = createFormFiller({ formWaitMs: 800, confirmWaitMs: 1500 });
    const res = await filler.fill({ url: page("#nothanks"), platform: "greenhouse", answers, resumePdfPath: pdf, submit: true, screenshotPath: shot });
    expect(res).toMatchObject({ ok: false, submitted: false, blocker: null });
    expect(res.error).toMatch(/No confirmation/);
    expect(existsSync(shot)).toBe(true);
  });

  it("a CAPTCHA that appears after clicking submit -> blocker captcha, not submitted", async () => {
    const { pdf } = setup();
    const filler = createFormFiller({ formWaitMs: 800, confirmWaitMs: 5000 });
    const res = await filler.fill({ url: page("#captcha"), platform: "greenhouse", answers, resumePdfPath: pdf, submit: true });
    expect(res).toMatchObject({ ok: false, submitted: false, blocker: "captcha" });
  });

  it("an answer that isn't among the dropdown options fails the fill instead of guessing", async () => {
    const { pdf, shot } = setup();
    const filler = createFormFiller({ formWaitMs: 800 });
    const res = await filler.fill({ url: page(), platform: "greenhouse", answers: { ...answers, q_sponsor: "Maybe" }, resumePdfPath: pdf, submit: false, screenshotPath: shot });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/No option matching "Maybe"/);
    expect(existsSync(shot)).toBe(true); // screenshot even on failure
  });

  // Smoke test on the REAL saved Lever and Ashby pages: every locator strategy (label click, Yes/No buttons, file input) must find its element.
  it.each(["lever", "ashby"] as const)("fills every field of the saved %s page without a locator error", async (platform) => {
    const { pdf, shot } = setup();
    const url = pathToFileURL(resolve(import.meta.dirname, `../fixtures/forms/${platform}.html`)).href;
    const scan = await prescanUrl(url, platform, { formWaitMs: 800 });
    const values: Record<string, string> = {};
    for (const f of scan.fields) {
      if (f.type === "file") continue;
      values[f.name] = f.options.length ? f.options[0] : f.type === "checkbox" ? "yes" : "test value";
    }
    expect(Object.keys(values).length).toBeGreaterThan(5);
    const res = await createFormFiller({ formWaitMs: 800 }).fill({ url, platform, answers: values, resumePdfPath: pdf, submit: false, screenshotPath: shot });
    expect(res.error).toBeNull();
    expect(res.ok).toBe(true);
  });

  it("platform 'other' is refused without opening a browser", async () => {
    const res = await createFormFiller().fill({ url: "https://x.example", platform: "other", answers: {}, resumePdfPath: "x", submit: false });
    expect(res.blocker).toBe("unsupported_platform");
  });
});
