import type { RedFlag } from "@contracts";
import { Badge } from "@/components/ui/badge";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

export function CompanyMark({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-[#efede7] text-[10.5px] font-semibold tracking-[0.02em] text-[#5b5851]", className)}
    >
      {initials(name)}
    </span>
  );
}

const FLAG_LABEL: Record<RedFlag["type"], string> = {
  seniority: "Seniority",
  location: "Location",
  visa: "Visa",
  notice: "Notice",
  salary: "Salary",
  other: "Flag",
};

export function FlagChip({ flag }: { flag: RedFlag }) {
  const hard = flag.type === "seniority" || flag.type === "visa";
  return (
    <Badge tone={hard ? "danger" : "warning"} title={flag.detail}>
      {FLAG_LABEL[flag.type]}
    </Badge>
  );
}
