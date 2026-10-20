import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Play } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { VariantStats } from "@contracts";
import { api } from "@/lib/api";
import { useLoop, useToggleLoop } from "@/lib/queries";
import { useDocumentTitle } from "@/lib/hooks";
import { useToast } from "@/lib/toast";
import { formatSalary, timeAgo, SOURCE_LABEL } from "@/lib/format";
import { Card, CardHeader, EmptyState, ErrorState, Skeleton } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Chip, StatusBadge } from "@/components/ui/badge";
import { MatchBar, Switch } from "@/components/ui/controls";
import { CompanyMark } from "@/components/jobs/parts";
import { FilterChips, MiniFunnel } from "./Loops";

const pct = (r: number) => `${Math.round(r * 100)}%`;

/** Response-rate bars per variant. Sample sizes are always shown, and tiny samples get a caution. */
function VariantComparison({ variants }: { variants: VariantStats[] }) {
  const max = Math.max(0.01, ...variants.map((v) => v.responseRate));
  const small = variants.some((v) => v.applied < 10);
  return (
    <Card>
      <CardHeader title="Resume variants" />
      <div className="space-y-5 p-5">
        {variants.length === 0 && <p className="text-[13px] text-muted">This loop uses your default resume. Add two variants to compare reply rates.</p>}
        {variants.map((v) => (
          <div key={v.variantId}>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-[13.5px] font-medium">Variant {v.variantName}</span>
              <span className="text-[12.5px] text-muted">
                <span className="num text-text">{v.replied}</span> replies from <span className="num text-text">{v.applied}</span> applied (n = {v.applied})
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[#eceae3]" role="img" aria-label={`Variant ${v.variantName}: ${pct(v.responseRate)} response rate from ${v.applied} applications`}>
                <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${(v.responseRate / max) * 100}%` }} />
              </div>
              <span className="num w-10 text-right text-[13px]">{pct(v.responseRate)}</span>
            </div>
          </div>
        ))}
        {variants.length > 1 && small && (
          <p className="rounded-[8px] bg-[#f6eedd] px-3 py-2 text-[12.5px] text-warning">
            Sample sizes are small (under 10 applications each), so treat any gap as noise for now.
          </p>
        )}
      </div>
    </Card>
  );
}

export default function LoopDetailPage() {
  const { id } = useParams();
  const loopId = Number(id);
  const { data: loop, isLoading, isError, refetch } = useLoop(loopId);
  useDocumentTitle(loop?.name ?? "Loop");
  const toggle = useToggleLoop();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const run = useMutation({
    mutationFn: () => api.runLoop(loopId),
    onSuccess: async () => {
      await qc.invalidateQueries();
      toast("Run started");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const jobs = useQuery({ queryKey: ["jobs", { loopId, pageSize: 8 }], queryFn: () => api.jobs({ loopId, pageSize: 8 }), enabled: Number.isFinite(loopId) });
  const apps = useQuery({ queryKey: ["applications", { loopId }], queryFn: () => api.applications({ loopId }), enabled: Number.isFinite(loopId) });

  if (isError) {
    return (
      <Card>
        <ErrorState message="That loop could not be loaded. It may have been deleted." onRetry={() => refetch()} />
      </Card>
    );
  }

  return (
    <>
      <Link to="/loops" className="mb-3 inline-flex items-center gap-1 rounded-sm text-[12.5px] text-muted hover:text-text">
        <ChevronLeft className="size-[14px]" strokeWidth={1.5} /> All loops
      </Link>

      {isLoading || !loop ? (
        <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-24" /><Skeleton className="h-48" /></div>
      ) : (
        <>
          <header className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-[22px] leading-8">{loop.name}</h1>
              <p className="mt-0.5 text-[13.5px] text-muted">
                {loop.active ? (loop.nextRunAt ? `Next run ${timeAgo(loop.nextRunAt)}` : "Scheduling") : "Paused"} {"·"} last run {timeAgo(loop.lastRunAt)}
              </p>
              <div className="mt-3"><FilterChips loop={loop} /></div>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-[13px] text-muted">
                {loop.active ? "On" : "Off"}
                <Switch checked={loop.active} onCheckedChange={(active) => toggle.mutate({ id: loop.id, active })} aria-label="Loop on or off" />
              </label>
              <Button onClick={() => run.mutate()} disabled={run.isPending}><Play strokeWidth={1.5} /> Run now</Button>
            </div>
          </header>

          <div className="grid grid-cols-5 gap-4">
            <Card className="col-span-2 p-5">
              <p className="mb-3 text-[13px] text-muted">Funnel</p>
              <MiniFunnel stats={loop.stats} />
              <p className="mt-4 text-[12.5px] text-muted">
                Response rate <span className="num text-text">{pct(loop.stats.responseRate)}</span> across <span className="num text-text">{loop.stats.applied}</span> applications
              </p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {loop.sources.map((s) => <Chip key={s}>{SOURCE_LABEL[s]}</Chip>)}
              </div>
            </Card>
            <div className="col-span-3"><VariantComparison variants={loop.variants} /></div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4">
            <Card>
              <CardHeader title="Jobs from this loop" action={<Link to="/jobs" className="rounded-sm text-[12.5px] font-medium text-accent hover:underline">All jobs</Link>} />
              {jobs.isLoading ? (
                <div className="space-y-3 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-8" />)}</div>
              ) : jobs.data && jobs.data.items.length > 0 ? (
                <ul className="divide-y divide-border">
                  {jobs.data.items.map((j) => (
                    <li key={j.id}>
                      <button onClick={() => navigate(`/jobs?job=${j.id}`)} className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-hover">
                        <CompanyMark name={j.company} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-medium">{j.company}</span>
                          <span className="block truncate text-[12.5px] text-muted">{[j.title, formatSalary(j.salaryMin, j.salaryMax, j.salaryCurrency)].filter((s) => s !== "-").join(" · ")}</span>
                        </span>
                        <MatchBar value={j.matchScore} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No jobs yet" hint="Run the loop to fetch its first batch." action={<Button onClick={() => run.mutate()}>Run now</Button>} />
              )}
            </Card>

            <Card>
              <CardHeader title="Applications" action={<Link to="/applications" className="rounded-sm text-[12.5px] font-medium text-accent hover:underline">All applications</Link>} />
              {apps.isLoading ? (
                <div className="space-y-3 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-8" />)}</div>
              ) : apps.data && apps.data.length > 0 ? (
                <ul className="divide-y divide-border">
                  {apps.data.slice(0, 8).map((a) => (
                    <li key={a.id}>
                      <Link to={`/applications?app=${a.id}`} className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-hover">
                        <CompanyMark name={a.company} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-medium">{a.company}</span>
                          <span className="block truncate text-[12.5px] text-muted">{a.title}{a.variantName ? ` · Variant ${a.variantName}` : ""}</span>
                        </span>
                        <StatusBadge status={a.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No applications yet" hint="Approved jobs from this loop show up here." />
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
