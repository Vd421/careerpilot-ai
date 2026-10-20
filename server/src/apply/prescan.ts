import { chromium, type Browser, type Page } from "playwright";
import { AUTO_APPLY_PLATFORMS, type ApplyPlatform, type FieldType, type FormField, type ManualReason, type PrescanResult } from "../contracts.js";
import { EXTRACT_FIELDS_SCRIPT, FIND_CAPTCHA_SCRIPT, FIND_LOGIN_WALL_SCRIPT } from "./pageScripts.js";

// ---------------------------------------------------------------------------
// Standard fields: filled from resume.json, never asked on Telegram
// ---------------------------------------------------------------------------

export const STANDARD_KEYS = [
  "first_name", "last_name", "full_name", "email", "phone", "phone_country",
  "resume", "cover_letter", "linkedin", "github", "website",
] as const;
export type StandardKey = (typeof STANDARD_KEYS)[number];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Decides from the field's name and label. Order matters (most specific first).
export function standardKeyOf(f: Pick<FormField, "name" | "label" | "type">): StandardKey | null {
  const name = norm(f.name);
  const label = norm(f.label);
  const both = `${name} ${label}`;
  if (f.type === "file") {
    if (/cover/.test(both)) return "cover_letter";
    if (/resume|cv\b/.test(both)) return "resume";
    return null;
  }
  if (name === "country" && label === "country") return "phone_country"; // Greenhouse phone-country picker
  if (/\bfirst name\b|^given name$/.test(label) || name === "first name") return "first_name";
  if (/\blast name\b|\bsurname\b|^family name$/.test(label) || name === "last name") return "last_name";
  if (label === "full name" || label === "name" || name === "systemfield name" || name === "name") return "full_name";
  if (label === "email" || label === "email address" || name === "email" || name === "systemfield email") return "email";
  if (/^phone( number)?$|^mobile( number)?$/.test(label) || name === "phone") return "phone";
  if (/linkedin/.test(both)) return "linkedin";
  if (/github/.test(both)) return "github";
  if (/portfolio|personal (site|website)|^website|your website/.test(label) || name === "urls portfolio") return "website";
  return null;
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

// Pasted/posted URLs point at the job description; the form lives at a platform-specific path.
export function formUrlFor(url: string, platform: ApplyPlatform): string {
  if (!/^https?:/i.test(url)) return url; // file:// fixtures are already the form page
  const u = new URL(url);
  u.hash = "";
  u.search = platform === "greenhouse" ? u.search : "";
  const path = u.pathname.replace(/\/+$/, "");
  if (platform === "lever" && !path.endsWith("/apply")) u.pathname = `${path}/apply`;
  if (platform === "ashby" && !path.endsWith("/application")) u.pathname = `${path}/application`;
  return u.toString();
}

// ---------------------------------------------------------------------------
// Prescan
// ---------------------------------------------------------------------------

interface RawControl {
  name: string;
  label: string;
  type: FieldType | "combobox";
  required: boolean;
  options: string[];
  menuId: string | null;
}

export interface PrescanOptions {
  browser?: Browser; // reuse one browser; otherwise a headless Chromium is started and closed
  timeoutMs?: number;
  formWaitMs?: number; // how long to wait for the form to render before calling it unknown
  readMenus?: boolean; // open custom dropdowns to read their options (default true)
}

const FORM_READY_SELECTOR: Record<Exclude<ApplyPlatform, "other">, string> = {
  greenhouse: "#application-form, #application_form, form input",
  lever: "#application-form, li.application-question",
  ashby: ".ashby-application-form-field-entry, input[type=file]",
};
const MAX_MENU_OPTIONS = 80; // a country list is not a question I can answer from the bank

// Opens a react-select style dropdown, reads its options, closes it. It types nothing.
async function readMenuOptions(page: Page, id: string): Promise<string[]> {
  const input = page.locator(`[id="${id}"]`).first();
  try {
    await input.click({ timeout: 2000 });
    await page.waitForTimeout(250);
    const texts = await page.$$eval('[role="option"]', (els) => els.map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim()));
    await page.keyboard.press("Escape");
    return [...new Set(texts.filter(Boolean))];
  } catch {
    return [];
  }
}

export async function prescanPage(page: Page, platform: ApplyPlatform, opts: { readMenus?: boolean } = {}): Promise<PrescanResult> {
  const raw = (await page.evaluate(`(${EXTRACT_FIELDS_SCRIPT})(${JSON.stringify(platform)})`)) as RawControl[];
  const fields: FormField[] = [];
  for (const c of raw) {
    let type: FieldType = c.type === "combobox" ? "select" : c.type;
    let options = c.options;
    if (c.menuId) {
      const std = standardKeyOf({ name: c.name, label: c.label, type });
      const isAutocomplete = /\b(location|city)\b/i.test(`${c.name} ${c.label}`); // type-ahead, not a fixed list
      if (std === "phone_country") options = [];
      else if (isAutocomplete) type = "text";
      else if (opts.readMenus !== false) {
        options = await readMenuOptions(page, c.menuId);
        if (options.length > MAX_MENU_OPTIONS) options = [];
      }
    }
    fields.push({ name: c.name, label: c.label, type, required: c.required, options });
  }

  const captcha = (await page.evaluate(`(${FIND_CAPTCHA_SCRIPT})()`)) as string | null;
  if (captcha) {
    console.warn(`[prescan] visible captcha: ${captcha}`);
    return { ok: false, fields, blocker: "captcha" };
  }
  if (fields.length === 0) {
    const login = (await page.evaluate(`(${FIND_LOGIN_WALL_SCRIPT})()`)) as boolean;
    console.warn(`[prescan] no form fields found${login ? " (login wall)" : ""}`);
    return { ok: false, fields, blocker: "unknown_form" };
  }
  // A form without any resume upload or email is not an application form we understand.
  if (!fields.some((f) => standardKeyOf(f) === "email")) {
    return { ok: false, fields, blocker: "unknown_form" };
  }
  return { ok: true, fields, blocker: null };
}

export async function prescanUrl(
  url: string,
  platform: ApplyPlatform,
  opts: PrescanOptions = {},
): Promise<PrescanResult> {
  if (!AUTO_APPLY_PLATFORMS.includes(platform)) {
    return { ok: false, fields: [], blocker: "unsupported_platform" satisfies ManualReason };
  }
  const timeout = opts.timeoutMs ?? 30_000;
  const browser = opts.browser ?? (await chromium.launch({ headless: true }));
  const page = await browser.newPage();
  try {
    const res = await page.goto(formUrlFor(url, platform), { waitUntil: "domcontentloaded", timeout });
    if (res && res.status() >= 400) {
      console.warn(`[prescan] ${url} -> HTTP ${res.status()}`);
      return { ok: false, fields: [], blocker: "unknown_form" };
    }
    await page.waitForSelector(FORM_READY_SELECTOR[platform as Exclude<ApplyPlatform, "other">], { timeout: opts.formWaitMs ?? 12_000 }).catch(() => {});
    await page.waitForTimeout(500); // let React finish rendering the fields
    return await prescanPage(page, platform, { readMenus: opts.readMenus });
  } catch (err) {
    console.warn(`[prescan] ${url} failed: ${(err as Error).message}`);
    return { ok: false, fields: [], blocker: "unknown_form" };
  } finally {
    await page.close().catch(() => {});
    if (!opts.browser) await browser.close().catch(() => {});
  }
}
