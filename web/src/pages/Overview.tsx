import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Link } from "react-router-dom";
import { ArrowUpRight, Briefcase, CircleHelp, Inbox, MessageSquareReply, Send, Hand, ShieldCheck } from "lucide-react";
import type { AttentionItem } from "@contracts";
import { useOverview } from "@/lib/queries";
import { useDocumentTitle } from "@/lib/hooks";
import { timeAgo } from "@/lib/format";
import { Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui/card";
import { CountUp, Reveal } from "@/components/motion";
import { ActivityRow } from "@/components/ActivityRow";
import { Badge } from "@/components/ui/badge";

const STATS = [
  { key: "discovered", label: "Discovered", icon: Briefcase, hint: "passed your filters" },
  { key: "applied", label: "Applied", icon: Send, hint: "applications submitted" },
  { key: "awaitingMe", label: "Awaiting me", icon: Inbox, hint: "approvals and questions" },
  { key: "replies", label: "Replies", icon: MessageSquareReply, hint: "recruiters who responded" },
] as const;

const KIND = {
  approval: { icon: ShieldCheck, label: "Approval", tone: "warning" as const, to: (a: AttentionItem) => `/applications?app=${a.id}`, note: "Approve on Telegram" },
  question: { icon: CircleHelp, label: "Question", tone: "info" as const, to: () => "/questions", note: null },
  submit: { icon: Send, label: "Ready to submit", tone: "accent" as const, to: (a: AttentionItem) => `/applications?app=${a.id}`, note: "Approve on Telegram" },
  manual: { icon: Hand, label: "Manual", tone: "neutral" as const, to: (a: AttentionItem) => `/applications?app=${a.id}`, note: null },
};

const FUNNEL_FILLS = ["#2F6F6B", "#4A8480", "#6A9C98", "#8CB2AE", "#AECAC6", "#CDDEDB"];

export default function OverviewPage() {
  useDocumentTitle("Overview");
  const { data, isLoading, isError, refetch } = useOverview();

  return (
    <>
      <PageHeader title="Overview" description="What the agent has done, and what needs you." />

      <section aria-label="Key numbers" className="grid grid-cols-4 gap-4">
        {STATS.map(({ key, label, icon: Icon, hint }, i) => (
          <Reveal key={key} index={i}>
            <Card className="p-5">
              <div className="flex items-center justify-between text-muted">
                <span className="text-[13px]">{label}</span>
                <Icon className="size-4" strokeWidth={1.5} />
              </div>
              {isLoading || !data ? (
                <Skeleton className="mt-3 h-8 w-16" />
              ) : (
                <div className="num mt-2 text-[32px] font-medium leading-10 tracking-[-0.03em]" aria-label={`${label}: ${data.stats[key]}`}>
                  <CountUp value={data.stats[key]} />
                </div>
              )}
              <p className="mt-0.5 text-[12.5px] text-muted">{hint}</p>
            </Card>
          </Reveal>
        ))}
      </section>

      {isError && (
        <Card className="mt-6">
          <ErrorState onRetry={() => refetch()} />
        </Card>
      )}

      <div className="mt-6 grid grid-cols-5 gap-4">
        <Card className="col-span-2">
          <CardHeader title="Pipeline" />
          <div className="px-3 py-4">
            {isLoading || !data ? (
              <div className="space-y-3 px-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-5" style={{ width: `${95 - i * 13}%` }} />
                ))}
              </div>
            ) : (
              <div role="img" aria-label={`Pipeline: ${data.funnel.map((f) => `${f.stage} ${f.count}`).join(", ")}`} className="h-[252px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.funnel} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }} barCategoryGap={10}>
                    <XAxis type="number" hide domain={[0, "dataMax"]} />
                    <YAxis type="category" dataKey="stage" width={84} axisLine={false} tickLine={false} tick={{ fontSize: 13, fill: "#6B6862" }} />
                    <Bar dataKey="count" radius={[4, 4, 4, 4]} isAnimationActive animationDuration={500} animationEasing="ease-out">
                      {data.funnel.map((_, i) => (
                        <Cell key={i} fill={FUNNEL_FILLS[i]} />
                      ))}
                      <LabelList dataKey="count" position="right" style={{ fontSize: 12.5, fill: "#1F1E1B", fontFamily: "var(--font-mono)" }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </Card>

        <Card className="col-span-3">
          <CardHeader title="Needs your attention" action={data && data.attention.length > 0 ? <Badge tone="warning">{data.attention.length}</Badge> : undefined} />
          {isLoading || !data ? (
            <div className="space-y-4 p-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9" />
              ))}
            </div>
          ) : data.attention.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="You are all caught up" hint="New approvals and questions will land here and on Telegram." />
          ) : (
            <ul className="max-h-[300px] divide-y divide-border overflow-y-auto">
              {data.attention.map((a, i) => {
                const k = KIND[a.kind];
                return (
                  <Reveal as="li" index={i} key={`${a.kind}-${a.id}`}>
                    <Link to={k.to(a)} className="group flex items-center gap-3.5 px-5 py-3 transition-colors hover:bg-hover">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-[#f3f2ee] text-[#55524b]">
                        <k.icon className="size-4" strokeWidth={1.5} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium">{a.title}</span>
                        <span className="block truncate text-[12.5px] text-muted">{k.note ?? a.subtitle}</span>
                      </span>
                      <Badge tone={k.tone}>{k.label}</Badge>
                      <span className="num w-14 text-right text-[11.5px] text-muted">{timeAgo(a.createdAt)}</span>
                      <ArrowUpRight className="size-4 text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" strokeWidth={1.5} />
                    </Link>
                  </Reveal>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Recent activity"
          action={
            <Link to="/activity" className="rounded-sm text-[12.5px] font-medium text-accent hover:underline">
              View all
            </Link>
          }
        />
        <div className="px-5 pt-5">
          {isLoading || !data ? (
            <div className="space-y-5 pb-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8" />
              ))}
            </div>
          ) : data.recentActivity.length === 0 ? (
            <EmptyState title="Nothing has happened yet" hint="Add a job or turn on a loop to get started." />
          ) : (
            data.recentActivity.map((a, i) => (
              <Reveal key={a.id} index={i}>
                <ActivityRow item={a} last={i === data.recentActivity.length - 1} compact />
              </Reveal>
            ))
          )}
        </div>
      </Card>
    </>
  );
}
