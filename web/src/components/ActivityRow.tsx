import { Link } from "react-router-dom";
import type { ActivityItem } from "@contracts";
import { activityDetail, activityTitle, activityTone } from "@/lib/activity";
import { formatDateTime, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

const dot: Record<string, string> = {
  neutral: "bg-[#b9b5aa]",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

/** One timeline entry. `last` hides the rail below the final dot. */
export function ActivityRow({ item, last, compact }: { item: ActivityItem; last?: boolean; compact?: boolean }) {
  const detail = activityDetail(item);
  return (
    <div className="relative flex gap-3.5">
      <div className="relative flex w-3 shrink-0 justify-center">
        {!last && <span className="absolute bottom-[-14px] top-4 w-px bg-[#dcd9d0]" aria-hidden />}
        <span className={cn("relative mt-[7px] size-2 rounded-full ring-4 ring-surface", dot[activityTone(item.type)])} aria-hidden />
      </div>
      <div className={cn("min-w-0 flex-1", compact ? "pb-3.5" : "pb-5")}>
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[13.5px] font-medium">{activityTitle(item.type)}</p>
          <time dateTime={item.createdAt} title={formatDateTime(item.createdAt)} className="num shrink-0 text-[11.5px] text-muted">
            {timeAgo(item.createdAt)}
          </time>
        </div>
        {(item.jobLabel || detail) && (
          <p className="mt-0.5 truncate text-[13px] text-muted">
            {item.jobId && item.jobLabel ? (
              <Link to={`/jobs?job=${item.jobId}`} className="rounded-sm text-[#55524b] hover:text-accent hover:underline">
                {item.jobLabel}
              </Link>
            ) : (
              item.jobLabel
            )}
            {item.jobLabel && detail ? " · " : ""}
            {detail}
          </p>
        )}
      </div>
    </div>
  );
}
