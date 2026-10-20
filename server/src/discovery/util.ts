import type { ApplyPlatform, HttpGet } from "../contracts.js";

// Real HTTP: plain fetch with an honest User-Agent. Tests inject a fake instead.
export const defaultHttpGet: HttpGet = async (url, headers = {}) => {
  const res = await fetch(url, {
    headers: { "User-Agent": "CareerPilot (personal job search)", Accept: "application/json, */*", ...headers },
    signal: AbortSignal.timeout(20_000),
  });
  return { status: res.status, body: await res.text() };
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-",
  rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', hellip: "...", bull: "-",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

// HTML -> readable plain text (the scorer and the dashboard only need text).
export function htmlToText(html: string): string {
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>|<\/(p|div|h[1-6]|ul|ol|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Greenhouse sends its HTML entity-escaped ("&lt;p&gt;"), so decode once, then strip.
export const escapedHtmlToText = (s: string): string => htmlToText(decodeEntities(s));

const HOURS_PER_YEAR = 2080;
const PERIOD_MULTIPLIER: Record<string, number> = {
  year: 1, yearly: 1, annual: 1, annually: 1,
  month: 12, monthly: 12,
  week: 52, weekly: 52,
  day: 260, daily: 260,
  hour: HOURS_PER_YEAR, hourly: HOURS_PER_YEAR,
};

// Salaries are stored yearly. Unknown period -> null (better unknown than wrong).
export function toYearly(amount: number | null | undefined, period: string | null | undefined): number | null {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null;
  const key = (period ?? "year").toLowerCase().replace(/^per[- ]/, "").replace(/[- ](salary|wage)$/, "").replace(/^1 /, "");
  const mult = PERIOD_MULTIPLIER[key];
  return mult ? Math.round(amount * mult) : null;
}

export function platformFromUrl(url: string | null | undefined): ApplyPlatform {
  if (!url) return "other";
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "other";
  }
  const is = (d: string) => host === d || host.endsWith(`.${d}`);
  if (is("greenhouse.io")) return "greenhouse";
  if (is("lever.co")) return "lever";
  if (is("ashbyhq.com")) return "ashby";
  return "other";
}

export function isoFromEpoch(value: number | string | null | undefined, unit: "s" | "ms" = "s"): string | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  const d = Number.isFinite(n) ? new Date(unit === "s" ? n * 1000 : n) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function looksRemote(...texts: (string | null | undefined)[]): boolean | null {
  return texts.some((t) => t && /\bremote\b|work from home|anywhere/i.test(t)) ? true : null;
}

// GET + status check + JSON parse; null on any failure so one bad board never aborts a run.
export async function getJson(http: HttpGet, url: string, headers?: Record<string, string>): Promise<unknown | null> {
  try {
    const res = await http(url, headers);
    if (res.status !== 200) {
      console.warn(`[discovery] ${url} -> HTTP ${res.status}`);
      return null;
    }
    return JSON.parse(res.body);
  } catch (err) {
    console.warn(`[discovery] ${url} failed: ${(err as Error).message}`);
    return null;
  }
}

export const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
export const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
