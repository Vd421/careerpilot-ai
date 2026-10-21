import type { ActivityItem, AgentActionType } from "@contracts";
import { AGENT_ACTION_TYPES } from "@contracts";
import { SOURCE_LABEL, type Tone } from "./format";

export const ACTIVITY_GROUPS = [
  { id: "discovery", label: "Discovery", prefixes: ["job."] },
  { id: "resume", label: "Resume", prefixes: ["resume."] },
  { id: "telegram", label: "Telegram", prefixes: ["telegram."] },
  { id: "questions", label: "Questions", prefixes: ["question.", "answer.", "form."] },
  { id: "apply", label: "Applying", prefixes: ["apply.", "application."] },
  { id: "loops", label: "Loops and settings", prefixes: ["loop.", "settings."] },
] as const;
export type ActivityGroupId = (typeof ACTIVITY_GROUPS)[number]["id"];

export function groupOf(type: AgentActionType): ActivityGroupId {
  return ACTIVITY_GROUPS.find((g) => g.prefixes.some((p) => type.startsWith(p)))?.id ?? "discovery";
}

export function typesInGroup(id: ActivityGroupId): AgentActionType[] {
  return AGENT_ACTION_TYPES.filter((t) => groupOf(t) === id);
}

const TITLES: Record<AgentActionType, string> = {
  "job.discovered": "Found a new job",
  "job.deduped": "Skipped a duplicate",
  "job.scored": "Scored a job",
  "job.filtered_out": "Filtered a job out",
  "job.pushed": "Queued for your approval",
  "resume.tailored": "Tailored the resume",
  "resume.tailor_rejected": "Rejected a tailored resume",
  "resume.pdf_rendered": "Rendered the resume PDF",
  "resume.refined": "Refined the resume from chat",
  "resume.refine_rejected": "Refused a resume edit that would invent something",
  "resume.restored": "Restored an earlier resume version",
  "telegram.card_sent": "Sent a Telegram card",
  "telegram.tap": "You tapped a Telegram button",
  "application.approved": "You approved the application",
  "application.skipped": "Skipped the application",
  "application.manual": "Moved to manual apply",
  "application.marked_applied": "You marked it as applied",
  "form.prescanned": "Scanned the application form",
  "question.matched_bank": "Answered from the answer bank",
  "question.asked": "Asked you a question",
  "question.answered": "You answered a question",
  "answer.polished": "Polished an answer",
  "answer.approved": "You approved an answer",
  "apply.filled": "Filled the form",
  "apply.dry_run": "Dry run finished, nothing submitted",
  "apply.submit_approved": "You approved the submit",
  "apply.submitted": "Submitted the application",
  "apply.failed": "Filling the form failed",
  "apply.blocked_cap": "Blocked by the daily cap",
  "loop.run_started": "Loop run started",
  "loop.run_finished": "Loop run finished",
  "loop.paused": "Loop paused",
  "loop.resumed": "Loop resumed",
  "settings.updated": "Settings updated",
};

export const activityTitle = (t: AgentActionType) => TITLES[t];

export const activityTone = (t: AgentActionType): Tone => {
  if (t === "apply.submitted" || t === "application.marked_applied") return "success";
  if (t === "apply.failed" || t === "resume.tailor_rejected" || t === "resume.refine_rejected" || t === "apply.blocked_cap") return "danger";
  if (t === "application.manual" || t === "job.filtered_out") return "warning";
  if (t.startsWith("telegram") || t === "application.approved" || t === "answer.approved" || t === "apply.submit_approved") return "accent";
  return "neutral";
};

/** A short human line from the free-form detail object. Never dumps raw JSON. */
export function activityDetail(a: ActivityItem): string | null {
  const d = a.detail;
  if (typeof d.score === "number") return `Match ${d.score}%`;
  if (typeof d.source === "string") return `Source: ${SOURCE_LABEL[d.source as keyof typeof SOURCE_LABEL] ?? d.source}`;
  if (typeof d.variant === "string") return `Resume variant ${d.variant}`;
  if (Array.isArray(d.reasons) && d.reasons.length) return d.reasons.join("; ");
  if (typeof d.reason === "string") return d.reason.replace(/_/g, " ");
  if (typeof d.found === "number") return `${d.found} found, ${d.kept ?? 0} kept`;
  if (typeof d.key === "string") return d.key.replace(/_/g, " ");
  if (typeof d.loop === "string") return d.loop;
  return null;
}
