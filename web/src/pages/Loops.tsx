import { ArrowRight, Plus, Repeat2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { LoopItem } from "@contracts";
import { useLoops, useToggleLoop } from "@/lib/queries";
import { useDocumentTitle } from "@/lib/hooks";
import { timeAgo } from "@/lib/format";
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/badge";
import { Switch } from "@/components/ui/controls";
import { Reveal } from "@/components/motion";
import { LoopFormDialog, SCHEDULES } from "@/components/loops/LoopForm";

export function FilterChips({ loop }: { loop: LoopItem }) {
  const f = loop.filters;
  return (
    <div className="flex flex-wrap gap-1.5">
      {loop.keywords.slice(0, 4).map((k) => <Chip key={k}>{k}</Chip>)}
      {loop.keywords.length > 4 && <Chip className="text-muted">+{loop.keywords.length - 4}</Chip>}
      {loop.locations.slice(0, 2).map((k) => <Chip key={k} className="bg-[#f6f5f1]">{k}</Chip>)}
      {f.minScore != null && <Chip className="bg-accent-tint text-accent border-transparent">{"≥"} {f.minScore}%</Chip>}
      {f.remoteOnly && <Chip className="bg-accent-tint text-accent border-transparent">Remote only</Chip>}
    </div>
  );
}

export function MiniFunnel({ stats }: { stats: LoopItem["stats"] }) {
  const steps = [
    { label: "Found", n: stats.found },
    { label: "Applied", n: stats.applied },
    { label: "Replied", n: stats.replied },
  ];
  return (
    <div className="flex items-center gap-2" role="group" aria-label="Loop funnel">
      {steps.map((s, i) => (
        <div key={s.label} className="flex items-center gap-2">
          <div>
            <div className="num text-[17px] font-medium leading-5">{s.n}</div>
            <div className="text-[11.5px] text-muted">{s.label}</div>
          </div>
          {i < steps.length - 1 && <ArrowRight className="mx-1 size-[13px] text-[#b9b5aa]" strokeWidth={1.5} />}
        </div>
      ))}
    </div>
  );
}

export default function LoopsPage() {
  useDocumentTitle("Loops");
  const { data, isLoading, isError, refetch } = useLoops();
  const toggle = useToggleLoop();
  const [formOpen, setFormOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="Loops"
        description="Scheduled searches. Each loop finds, scores and queues jobs for you."
        actions={<Button variant="primary" onClick={() => setFormOpen(true)}><Plus strokeWidth={1.75} /> New loop</Button>}
      />

      {isError && <Card><ErrorState onRetry={() => refetch()} /></Card>}

      {isLoading && (
        <div className="grid grid-cols-2 gap-4">
          {[0, 1].map((i) => (
            <Card key={i} className="space-y-4 p-5">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-10" />
            </Card>
          ))}
        </div>
      )}

      {data && data.length === 0 && (
        <Card>
          <EmptyState icon={Repeat2} title="No loops yet" hint="A loop searches job boards for you on a schedule." action={<Button variant="primary" onClick={() => setFormOpen(true)}>Create your first loop</Button>} />
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4">
        {data?.map((l, i) => (
          <Reveal key={l.id} index={i}>
            <Card className="group relative p-5 transition-colors hover:border-[#d5d2c9]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-[15px]">
                    <Link to={`/loops/${l.id}`} className="rounded-sm after:absolute after:inset-0 after:rounded-[10px] hover:text-accent">
                      {l.name}
                    </Link>
                  </h2>
                  <p className="mt-0.5 text-[12.5px] text-muted">
                    {SCHEDULES.find((s) => s.value === l.schedule)?.label ?? l.schedule}
                    {" · "}
                    {l.active ? (l.nextRunAt ? `next run ${timeAgo(l.nextRunAt)}` : "scheduling...") : "paused"}
                  </p>
                </div>
                <label className="relative z-10 flex items-center gap-2 text-[12.5px] text-muted">
                  {l.active ? "On" : "Off"}
                  <Switch checked={l.active} onCheckedChange={(active) => toggle.mutate({ id: l.id, active })} aria-label={`${l.name} loop on or off`} />
                </label>
              </div>
              <div className="mt-4"><FilterChips loop={l} /></div>
              <div className="mt-5 flex items-end justify-between border-t border-border pt-4">
                <MiniFunnel stats={l.stats} />
                <span className="text-[12px] text-muted">Last run {timeAgo(l.lastRunAt)}</span>
              </div>
            </Card>
          </Reveal>
        ))}
      </div>

      <LoopFormDialog open={formOpen} onOpenChange={setFormOpen} />
    </>
  );
}
