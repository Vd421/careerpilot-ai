import type { ApplicationStatus, DisplayStatus, ManualReason, SourceId } from "@contracts";

export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const diff = now - new Date(iso).getTime();
  const m = Math.round(Math.abs(diff) / 60000);
  if (m < 1) return "just now";
  const label = m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
  return diff >= 0 ? `${label} ago` : `in ${label}`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", INR: "₹" };

export function formatMoney(n: number, cur: string | null): string {
  const c = cur ?? "";
  const sym = SYMBOL[c] ?? (c ? `${c} ` : "");
  if (c === "INR") return `${sym}${n >= 100000 ? `${+(n / 100000).toFixed(1)}L` : n}`;
  return `${sym}${n >= 1000 ? `${Math.round(n / 1000)}k` : n}`;
}

export function formatSalary(min: number | null, max: number | null, cur: string | null): string {
  if (min == null && max == null) return "-";
  if (min != null && max != null && min !== max) {
    const lo = formatMoney(min, cur);
    const hi = formatMoney(max, cur).replace(SYMBOL[cur ?? ""] ?? "", "");
    return `${lo}–${hi}`;
  }
  return formatMoney((min ?? max) as number, cur);
}

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  discovered: "Discovered",
  scored: "Scored",
  filtered_out: "Filtered out",
  pushed: "Pushed",
  pending_approval: "Awaiting you",
  skipped: "Skipped",
  needs_answers: "Needs answers",
  approved: "Approved",
  applied: "Applied",
  manual: "Manual",
  replied: "Replied",
  interview: "Interview",
  rejected: "Rejected",
  offer: "Offer",
};

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

export const STATUS_TONE: Record<DisplayStatus, Tone> = {
  discovered: "neutral",
  scored: "neutral",
  filtered_out: "neutral",
  pushed: "info",
  pending_approval: "warning",
  skipped: "neutral",
  needs_answers: "warning",
  approved: "accent",
  applied: "success",
  manual: "warning",
  replied: "info",
  interview: "accent",
  rejected: "danger",
  offer: "success",
};

export const SOURCE_LABEL: Record<SourceId, string> = {
  manual: "Pasted",
  jsearch: "JSearch",
  adzuna: "Adzuna",
  remotive: "Remotive",
  remoteok: "RemoteOK",
  himalayas: "Himalayas",
  arbeitnow: "Arbeitnow",
  weworkremotely: "We Work Remotely",
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
};

export const MANUAL_REASON_LABEL: Record<ManualReason, string> = {
  captcha: "CAPTCHA on the form",
  unknown_form: "Unrecognised form layout",
  unsupported_platform: "Platform is not auto-filled",
  unanswered: "A required question has no answer",
  daily_cap: "Daily cap reached",
  error: "Filling failed",
};

export const BOARD_COLUMNS: ApplicationStatus[] = [
  "pending_approval",
  "needs_answers",
  "approved",
  "manual",
  "applied",
  "replied",
  "interview",
  "offer",
  "rejected",
  "skipped",
];

export function initials(s: string) {
  return s
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export const MANUAL_REASON_SHORT: Record<ManualReason, string> = {
  captcha: "CAPTCHA",
  unknown_form: "Unknown form",
  unsupported_platform: "Other platform",
  unanswered: "Unanswered",
  daily_cap: "Daily cap",
  error: "Error",
};
