import { LayoutGrid, Send, Table2 } from "lucide-react";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { ApplicationListItem, ApplicationStatus } from "@contracts";
import { useApplications } from "@/lib/queries";
import { useDocumentTitle, useLocalStorage } from "@/lib/hooks";
import { BOARD_COLUMNS, formatDate, STATUS_LABEL, MANUAL_REASON_SHORT } from "@/lib/format";
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Segmented } from "@/components/ui/controls";
import { Reveal } from "@/components/motion";
import { CompanyMark } from "@/components/jobs/parts";
import { ScreenshotThumb } from "@/components/applications/Screenshot";
import { ApplicationDrawer } from "@/components/applications/ApplicationDrawer";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

type View = "board" | "table";
const CORE: ApplicationStatus[] = ["pending_approval", "applied", "replied", "interview"];

function BoardCard({ a, i, onOpen }: { a: ApplicationListItem; i: number; onOpen: () => void }) {
  return (
    <Reveal index={i}>
      <div
        onClick={onOpen}
        className="cursor-pointer rounded-[10px] border border-border bg-surface p-3.5 shadow-card transition-colors hover:border-[#cfccc2] hover:bg-[#fdfdfb]"
      >
        <div className="flex items-start gap-2.5">
          <CompanyMark name={a.company} />
          <div className="min-w-0 flex-1">
            <button onClick={(e) => { e.stopPropagation(); onOpen(); }} className="block w-full truncate rounded-sm text-left text-[13.5px] font-medium hover:text-accent">{a.company}</button>
            <p className="truncate text-[12.5px] text-muted">{a.title}</p>
          </div>
          {a.screenshotUrl && <ScreenshotThumb url={a.screenshotUrl} label={a.company} className="h-8 w-11" />}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {a.variantName && <Badge tone="accent">Variant {a.variantName}</Badge>}
          {a.method && a.status !== "manual" && <Badge>{a.method === "auto" ? "Auto" : "Manual"}</Badge>}
          {a.manualReason && <Badge tone="warning">{MANUAL_REASON_SHORT[a.manualReason]}</Badge>}
          <span className="num ml-auto text-[11.5px] text-muted">{formatDate(a.appliedAt ?? a.createdAt).replace(/ \d{4}$/, "")}</span>
        </div>
      </div>
    </Reveal>
  );
}

export default function ApplicationsPage() {
  useDocumentTitle("Applications");
  const [view, setView] = useLocalStorage<View>("careerpilot.applications.view", "board");
  const [params, setParams] = useSearchParams();
  const openId = params.get("app") ? Number(params.get("app")) : null;
  const { data, isLoading, isError, refetch } = useApplications();

  const columns = useMemo(() => {
    const by = new Map<ApplicationStatus, ApplicationListItem[]>();
    for (const a of data ?? []) by.set(a.status, [...(by.get(a.status) ?? []), a]);
    return BOARD_COLUMNS.filter((s) => by.has(s) || CORE.includes(s)).map((s) => ({ status: s, items: by.get(s) ?? [] }));
  }, [data]);

  const open = (id: number) => setParams((p) => (p.set("app", String(id)), p));
  const close = () => setParams((p) => (p.delete("app"), p));

  return (
    <>
      <PageHeader
        title="Applications"
        description="Where every application stands. Approvals happen on Telegram."
        actions={
          <Segmented
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: "board", label: <><LayoutGrid className="size-[14px]" strokeWidth={1.5} /> Board</> },
              { value: "table", label: <><Table2 className="size-[14px]" strokeWidth={1.5} /> Table</> },
            ]}
          />
        }
      />

      {isError && <Card><ErrorState onRetry={() => refetch()} /></Card>}

      {!isError && data?.length === 0 && (
        <Card>
          <EmptyState
            icon={Send}
            title="No applications yet"
            hint="When you approve a job card on Telegram it shows up here."
            action={<Link to="/jobs"><Button variant="primary">Browse jobs</Button></Link>}
          />
        </Card>
      )}

      {view === "board" && !isError && (data?.length ?? 1) > 0 && (
        <div className="-mx-8 overflow-x-auto px-8 pb-4" tabIndex={-1}>
          <div className="flex min-w-max items-start gap-4">
            {isLoading
              ? Array.from({ length: 4 }).map((_, c) => (
                  <div key={c} className="w-[272px] space-y-3">
                    <Skeleton className="h-5 w-28" />
                    {Array.from({ length: 3 - (c % 2) }).map((__, r) => (
                      <Skeleton key={r} className="h-[92px] rounded-[10px]" />
                    ))}
                  </div>
                ))
              : columns.map((col) => (
                  <section key={col.status} aria-label={STATUS_LABEL[col.status]} className="w-[272px] shrink-0 rounded-[12px] bg-[#f3f2ee] p-2.5">
                    <header className="mb-2.5 flex items-center justify-between px-1.5 pt-0.5">
                      <StatusBadge status={col.status} />
                      <span className="num text-[12px] text-muted">{col.items.length}</span>
                    </header>
                    <div className="space-y-2.5">
                      {col.items.map((a, i) => (
                        <BoardCard key={a.id} a={a} i={i} onOpen={() => open(a.id)} />
                      ))}
                      {col.items.length === 0 && <p className="px-2 py-6 text-center text-[12.5px] text-muted">Nothing here yet</p>}
                    </div>
                  </section>
                ))}
          </div>
        </div>
      )}

      {view === "table" && !isError && (data?.length ?? 1) > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full table-fixed text-left text-[13px]">
            <colgroup>
              <col style={{ width: "20%" }} />
              <col style={{ width: "22%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "12%" }} />
            </colgroup>
            <thead>
              <tr className="border-b border-border text-[11.5px] uppercase tracking-[0.04em] text-muted">
                {["Company", "Role", "Status", "Resume", "Method", "Applied", "Screenshot"].map((h) => (
                  <th key={h} scope="col" className="h-10 px-4 font-medium first:pl-5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading &&
                Array.from({ length: 7 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {Array.from({ length: 7 }).map((__, c) => (
                      <td key={c} className="h-[56px] px-4 first:pl-5"><Skeleton className="h-3.5" style={{ width: `${50 + ((i + c * 9) % 40)}%` }} /></td>
                    ))}
                  </tr>
                ))}
              {data?.map((a, i) => (
                <Reveal as="tr" index={i} key={a.id} className={"h-[56px] cursor-pointer border-b border-border last:border-0 hover:bg-hover " + (openId === a.id ? "bg-accent-tint/60" : "")}>
                  <td className="px-4 pl-5" onClick={() => open(a.id)}>
                    <div className="flex items-center gap-2.5"><CompanyMark name={a.company} /><span className="truncate font-medium">{a.company}</span></div>
                  </td>
                  <td className="px-4" onClick={() => open(a.id)}>
                    <button onClick={(e) => { e.stopPropagation(); open(a.id); }} className="block w-full truncate rounded-sm text-left hover:text-accent">{a.title}</button>
                  </td>
                  <td className="px-4" onClick={() => open(a.id)}><StatusBadge status={a.status} /></td>
                  <td className="px-4" onClick={() => open(a.id)}>{a.variantName ? <Badge tone="accent">Variant {a.variantName}</Badge> : <span className="text-muted">-</span>}</td>
                  <td className="px-4 capitalize" onClick={() => open(a.id)}>{a.method ?? <span className="text-muted">-</span>}</td>
                  <td className="num px-4 text-[12.5px]" onClick={() => open(a.id)}>{formatDate(a.appliedAt)}</td>
                  <td className="px-4"><ScreenshotThumb url={a.screenshotUrl} label={a.company} /></td>
                </Reveal>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <ApplicationDrawer appId={openId} onClose={close} />
    </>
  );
}
