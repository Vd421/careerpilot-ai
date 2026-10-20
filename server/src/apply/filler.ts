import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium, type Locator, type Page } from "playwright";
import type { ApplyPlatform, FillResult } from "../contracts.js";
import { FIND_CAPTCHA_SCRIPT } from "./pageScripts.js";
import { extractControls, FORM_READY_SELECTOR, OPEN_OPTION, formUrlFor, prescanUrl, standardKeyOf, type RawControl } from "./prescan.js";
import type { FillRequestX, FormFillerX } from "./types.js";

export interface FillerOptions {
  headless?: boolean;
  // Safety switch: with false the filler throws if asked to submit. Tests that drive a real browser use false.
  allowSubmit?: boolean;
  formWaitMs?: number;
  confirmWaitMs?: number; // how long to wait for the "thank you" page after clicking submit
}

const SUBMIT_SELECTOR: Record<Exclude<ApplyPlatform, "other">, string> = {
  greenhouse: 'button[type="submit"], button:has-text("Submit application"), button:has-text("Submit")',
  lever: '#btn-submit, button[type="submit"]:not(.hidden)',
  ashby: ".ashby-application-form-submit-button, button[type=\"submit\"]",
};

const CONFIRM_URL = /confirmation|\/thanks|thank-you|\/submitted|success/i;
const CONFIRM_TEXT =
  /thank you for (applying|your (application|interest))|thanks for applying|application (has been |was )?(successfully )?(submitted|received)|we(?:'ve| have) received your application/i;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exact = (s: string) => new RegExp(`^\\s*${esc(s)}\\s*$`, "i");
const attr = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const YES = /^(yes|true|y|agree|i agree|accept|checked|consent)\b/i;

function control(page: Page, name: string): Locator {
  return page.locator(`[id="${attr(name)}"], [name="${attr(name)}"]`).first();
}

// react-select style dropdown: open it, pick the option whose text matches; type-ahead if it isn't listed yet.
async function pickFromMenu(page: Page, input: Locator, value: string, takeFirstOnTypeAhead: boolean): Promise<void> {
  await input.click();
  await page.waitForTimeout(200);
  const options = page.locator(OPEN_OPTION);
  let hit = options.filter({ hasText: exact(value) }).first();
  if ((await hit.count()) === 0) {
    await input.pressSequentially(value, { delay: 25 });
    await page.waitForTimeout(500);
    hit = options.filter({ hasText: exact(value) }).first();
    if ((await hit.count()) === 0) hit = options.filter({ hasText: new RegExp(esc(value), "i") }).first();
    if ((await hit.count()) === 0 && takeFirstOnTypeAhead) hit = options.first();
  }
  if ((await hit.count()) === 0) throw new Error(`No option matching "${value}"`);
  await hit.click();
}

async function fillControl(page: Page, platform: ApplyPlatform, c: RawControl, value: string): Promise<void> {
  const loc = control(page, c.name);
  switch (c.type) {
    case "text":
    case "textarea":
      await loc.fill(value);
      return;
    case "select":
    case "combobox": {
      const tag = await loc.evaluate((e) => e.tagName);
      if (tag === "SELECT") {
        const labels = await loc.evaluate((e) => Array.from((e as HTMLSelectElement).options).map((o) => (o.textContent ?? "").trim()));
        const label = labels.find((l) => exact(value).test(l));
        if (!label) throw new Error(`No option "${value}" in ${c.label}`);
        await loc.selectOption({ label });
      } else {
        await pickFromMenu(page, loc, value, /location|city/i.test(`${c.name} ${c.label}`));
      }
      return;
    }
    case "radio": {
      if (platform === "ashby") {
        // Ashby's Yes/No are buttons inside the field entry (the checkbox behind them is hidden)
        const entry = page.locator(`[data-field-path="${attr(c.name)}"]`).first();
        await entry.locator("button").filter({ hasText: exact(value) }).first().click();
        return;
      }
      const label = page.locator(`label:has(input[name="${attr(c.name)}"])`).filter({ hasText: exact(value) }).first();
      if ((await label.count()) > 0) await label.click();
      else await page.locator(`input[name="${attr(c.name)}"][value="${attr(value)}"]`).first().check();
      return;
    }
    case "checkbox": {
      if (c.options.length > 1) {
        for (const part of value.split(",").map((p) => p.trim()).filter(Boolean)) {
          await page.locator(`label:has(input[name="${attr(c.name)}"])`).filter({ hasText: exact(part) }).first().click();
        }
      } else if (YES.test(value.trim())) {
        await loc.check({ force: true });
      }
      return;
    }
    case "file":
      return; // only the resume is ever uploaded (see below)
  }
}

async function visibleCaptcha(page: Page): Promise<boolean> {
  return Boolean(await page.evaluate(`(${FIND_CAPTCHA_SCRIPT})()`));
}

// Fills the form. Clicks submit ONLY when req.submit is true (the caller has already checked the two taps,
// dry-run and the lock). Never throws for page problems: returns ok:false with the error and a screenshot.
export function createFormFiller(opts: FillerOptions = {}): FormFillerX {
  return {
    prescan: (url, platform) => prescanUrl(url, platform, { formWaitMs: opts.formWaitMs }),

    async fill(req: FillRequestX): Promise<FillResult> {
      if (req.submit && opts.allowSubmit === false) {
        throw new Error("This filler is configured with allowSubmit=false");
      }
      if (req.platform === "other") {
        return { ok: false, submitted: false, screenshotPath: null, blocker: "unsupported_platform", error: null };
      }
      const platform = req.platform as Exclude<ApplyPlatform, "other">;
      const browser = await chromium.launch({ headless: opts.headless ?? true });
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      let screenshotPath: string | null = null;
      const shot = async () => {
        if (!req.screenshotPath) return;
        try {
          await mkdir(dirname(req.screenshotPath), { recursive: true });
          await page.screenshot({ path: req.screenshotPath, fullPage: true });
          screenshotPath = req.screenshotPath;
        } catch {
          /* a failed screenshot must not hide the real result */
        }
      };
      try {
        await page.goto(formUrlFor(req.url, req.platform), { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForSelector(FORM_READY_SELECTOR[platform], { timeout: opts.formWaitMs ?? 12_000 }).catch(() => {});
        await page.waitForTimeout(500);

        if (await visibleCaptcha(page)) {
          await shot();
          return { ok: false, submitted: false, screenshotPath, blocker: "captcha", error: null };
        }

        const controls = await extractControls(page, req.platform);
        for (const c of controls) {
          const key = standardKeyOf({ name: c.name, label: c.label, type: c.type === "combobox" ? "select" : c.type });
          if (key === "resume") {
            await control(page, c.name).setInputFiles(req.resumePdfPath);
            continue;
          }
          const value = req.answers[c.name];
          if (value === undefined || value === "") continue; // optional and unknown: stays blank
          await fillControl(page, req.platform, c, value);
        }
        await page.waitForTimeout(300);

        if (!req.submit) {
          await shot();
          return { ok: true, submitted: false, screenshotPath, blocker: null, error: null };
        }

        // ---- the one place a submit button is clicked ----
        const before = page.url();
        await page.locator(SUBMIT_SELECTOR[platform]).first().click();
        const deadline = Date.now() + (opts.confirmWaitMs ?? 25_000);
        while (Date.now() < deadline) {
          await page.waitForTimeout(500);
          if (await visibleCaptcha(page)) {
            await shot();
            return { ok: false, submitted: false, screenshotPath, blocker: "captcha", error: "A CAPTCHA appeared after submitting" };
          }
          const urlChanged = page.url() !== before && CONFIRM_URL.test(page.url());
          const formGone = (await page.locator("input[type=file], .ashby-application-form-field-entry").count()) === 0;
          const text = await page.evaluate(() => document.body.innerText.slice(0, 5000));
          if (urlChanged || (formGone && CONFIRM_TEXT.test(text))) {
            await shot();
            return { ok: true, submitted: true, screenshotPath, blocker: null, error: null };
          }
        }
        await shot();
        return { ok: false, submitted: false, screenshotPath, blocker: null, error: "No confirmation page after submitting" };
      } catch (err) {
        await shot();
        return { ok: false, submitted: false, screenshotPath, blocker: null, error: (err as Error).message };
      } finally {
        await browser.close().catch(() => {});
      }
    },
  };
}
