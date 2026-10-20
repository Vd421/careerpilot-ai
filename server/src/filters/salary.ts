import type { SalaryFloors } from "../contracts.js";

export type SalaryPeriod = "hour" | "month" | "year" | "lpa";

// Everything is compared as a yearly amount.
export function toYearly(amount: number, period: SalaryPeriod): number {
  switch (period) {
    case "hour":
      return amount * 2080; // 40h x 52w
    case "month":
      return amount * 12;
    case "lpa":
      return amount * 100_000; // lakh per annum
    case "year":
      return amount;
  }
}

// Reads strings like "12 LPA", "15 lakh", "$50/hr", "80000 per month" into a yearly number.
// Returns null when it can't tell (we never guess a salary).
export function parseSalaryText(text: string): number | null {
  const t = text.toLowerCase().replace(/,/g, "");
  const m = t.match(
    /(\d+(?:\.\d+)?)\s*(k)?\s*(lpa|lakhs?|lacs?|\/\s*h(?:ou)?r|per hour|hourly|\/\s*mo(?:nth)?|per month|monthly|\/\s*y(?:ea)?r|per year|per annum|annual)?/,
  );
  if (!m) return null;
  let n = Number(m[1]);
  if (m[2]) n *= 1000;
  const unit = m[3] ?? "";
  if (/^(lpa|lakh|lac)/.test(unit)) return toYearly(n, "lpa");
  if (/h(ou)?r|hourly/.test(unit)) return toYearly(n, "hour");
  if (/mo|monthly/.test(unit)) return toYearly(n, "month");
  if (unit) return toYearly(n, "year");
  return null; // bare number: no unit, no guess
}

export type SalaryVerdict =
  | { kind: "unknown" }
  | { kind: "ok" }
  | { kind: "below"; value: number; floor: number; currency: string };

export function checkSalary(
  min: number | null,
  max: number | null,
  currency: string | null,
  floors: SalaryFloors,
): SalaryVerdict {
  const value = max ?? min; // the best the employer might pay
  if (value == null || !currency) return { kind: "unknown" };
  const cur = currency.toUpperCase();
  const floor = floors[cur];
  if (floor == null) return { kind: "unknown" };
  return value < floor ? { kind: "below", value, floor, currency: cur } : { kind: "ok" };
}
