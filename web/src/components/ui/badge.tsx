import type { DisplayStatus } from "@contracts";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, STATUS_TONE, type Tone } from "@/lib/format";

const tones: Record<Tone, string> = {
  neutral: "bg-[#efede7] text-[#5b5851]",
  accent: "bg-accent-tint text-accent",
  success: "bg-[#e9f1eb] text-success",
  warning: "bg-[#f6eedd] text-warning",
  danger: "bg-[#f5e7e5] text-danger",
  info: "bg-[#e6eef4] text-info",
};
const dots: Record<Tone, string> = {
  neutral: "bg-[#a39f95]",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

export function Badge({ tone = "neutral", dot, className, children, ...p }: { tone?: Tone; dot?: boolean } & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn("inline-flex h-5 items-center align-middle gap-1.5 whitespace-nowrap rounded-full px-2 text-[11.5px] font-medium", tones[tone], className)} {...p}>
      {dot && <span className={cn("size-1.5 rounded-full", dots[tone])} />}
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: DisplayStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

/** Quiet outline chip for filters / keywords. */
export function Chip({ className, children, ...p }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn("inline-flex h-6 items-center rounded-md border border-border bg-surface px-2 text-[12px] text-[#4a4843]", className)} {...p}>
      {children}
    </span>
  );
}
