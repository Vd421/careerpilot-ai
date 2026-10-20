import { useInfiniteQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { ACTIVITY_GROUPS, groupOf, type ActivityGroupId } from "@/lib/activity";
import { useJobs } from "@/lib/queries";
import { useDocumentTitle } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { ActivityRow } from "@/components/ActivityRow";
import { Reveal } from "@/components/motion";

const PAGE = 40;

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

export default function ActivityPage() {
  useDocumentTitle("Activity");
  const [group, setGroup] = useState<ActivityGroupId | "all">("all");
  const [jobId, setJobId] = useState<number | undefined>();
  const jobs = useJobs({ pageSize: 100 });

  const q = useInfiniteQuery({
    queryKey: ["activity", { jobId }],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => api.activity({ jobId, before: pageParam, limit: PAGE }),
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].id : undefined),
  });

  const items = useMemo(() => {
    const all = q.data?.pages.flat() ?? [];
    return group === "all" ? all : all.filter((a) => groupOf(a.type) === group);
  }, [q.data, group]);

  const days = useMemo(() => {
    const out: { label: string; rows: typeof items }[] = [];
    for (const it of items) {
      const label = dayLabel(it.createdAt);
      const last = out[out.length - 1];
      if (last?.label === label) last.rows.push(it);
      else out.push({ label, rows: [it] });
    }
    return out;
  }, [items]);

  return (
    <>
      <PageHeader title="Activity" description="Every step the agent takes is logged here, newest first." />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Filter by type" className="flex flex-wrap gap-1.5">
          {[{ id: "all" as const, label: "All" }, ...ACTIVITY_GROUPS].map((g) => (
            <button
              key={g.id}
              aria-pressed={group === g.id}
              onClick={() => setGroup(g.id)}
              className={cn(
                "h-7 rounded-full border px-3 text-[12.5px] font-medium transition-colors",
                group === g.id ? "border-accent bg-accent-tint text-accent" : "border-border bg-surface text-muted hover:border-[#d5d2c9] hover:text-text",
              )}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="ml-auto w-64">
          <Select aria-label="Filter by job" value={jobId ?? ""} onChange={(e) => setJobId(e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">All jobs</option>
            {jobs.data?.items.map((j) => (
              <option key={j.id} value={j.id}>
                {j.company} {"·"} {j.title}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Card className="px-6 py-5">
        {q.isLoading ? (
          <div className="space-y-6">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex gap-4">
                <Skeleton className="mt-1 size-2.5 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3.5 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : q.isError ? (
          <ErrorState onRetry={() => q.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={History}
            title="No activity matches"
            hint="Try a different type or job."
            action={
              <Button
                onClick={() => {
                  setGroup("all");
                  setJobId(undefined);
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <>
            {days.map((d) => (
              <section key={d.label} aria-label={d.label} className="mb-2">
                <h2 className="mb-3 text-[11.5px] font-medium uppercase tracking-[0.04em] text-muted">{d.label}</h2>
                {d.rows.map((a, i) => (
                  <Reveal key={a.id} index={i}>
                    <ActivityRow item={a} last={i === d.rows.length - 1} />
                  </Reveal>
                ))}
              </section>
            ))}
            {q.hasNextPage && (
              <div className="mt-2 flex justify-center">
                <Button onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
                  {q.isFetchingNextPage ? "Loading..." : "Load older activity"}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}
