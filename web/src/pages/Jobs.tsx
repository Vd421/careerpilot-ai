import { Briefcase, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { APPLICATION_STATUSES, JOB_STAGES, SOURCE_IDS } from "@contracts";
import { useJobs, useLoops } from "@/lib/queries";
import { useDebounced, useDocumentTitle } from "@/lib/hooks";
import { formatSalary, SOURCE_LABEL, STATUS_LABEL } from "@/lib/format";
import { useUi } from "@/lib/ui-context";
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/badge";
import { MatchBar } from "@/components/ui/controls";
import { Reveal } from "@/components/motion";
import { CompanyMark, FlagChip } from "@/components/jobs/parts";
import { JobDrawer } from "@/components/jobs/JobDrawer";

const PAGE_SIZE = 12;
const ALL_STATUSES = [...JOB_STAGES, ...APPLICATION_STATUSES];

export default function JobsPage() {
  useDocumentTitle("Jobs");
  const [params, setParams] = useSearchParams();
  const openId = params.get("job") ? Number(params.get("job")) : null;
  const { setNewJobOpen } = useUi();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [loopId, setLoopId] = useState("");
  const [page, setPage] = useState(1);
  const q = useDebounced(search, 200);

  const loops = useLoops();
  const jobs = useJobs({ q, status: status || undefined, source: source || undefined, loopId: loopId ? Number(loopId) : undefined, page, pageSize: PAGE_SIZE });
  const filtered = Boolean(search || status || source || loopId);

  const reset = () => {
    setSearch("");
    setStatus("");
    setSource("");
    setLoopId("");
    setPage(1);
  };
  const onFilter = (fn: (v: string) => void) => (e: { target: { value: string } }) => {
    fn(e.target.value);
    setPage(1);
  };
  const open = (id: number) => setParams((p) => (p.set("job", String(id)), p), { replace: false });
  const close = () => setParams((p) => (p.delete("job"), p));

  const total = jobs.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);

  return (
    <>
      <PageHeader title="Jobs" description="Everything found or pasted, scored against your resume." />

      <div className="mb-4 flex flex-wrap items-center gap-2.5" role="search" aria-label="Filter jobs">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-[14px] -translate-y-1/2 text-muted" strokeWidth={1.5} />
          <Input aria-label="Search jobs" placeholder="Search company or role" className="pl-8" value={search} onChange={onFilter(setSearch)} />
        </div>
        <div className="w-40">
          <Select aria-label="Status" value={status} onChange={onFilter(setStatus)}>
            <option value="">All statuses</option>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </Select>
        </div>
        <div className="w-40">
          <Select aria-label="Source" value={source} onChange={onFilter(setSource)}>
            <option value="">All sources</option>
            {SOURCE_IDS.map((s) => (
              <option key={s} value={s}>{SOURCE_LABEL[s]}</option>
            ))}
          </Select>
        </div>
        <div className="w-44">
          <Select aria-label="Loop" value={loopId} onChange={onFilter(setLoopId)}>
            <option value="">All loops</option>
            {loops.data?.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </Select>
        </div>
        {filtered && (
          <Button variant="ghost" onClick={reset}>
            <X strokeWidth={1.5} /> Clear
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        <table className="w-full table-fixed text-left text-[13px]">
          <colgroup>
            <col style={{ width: "18%" }} />
            <col style={{ width: "21%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "13%" }} />
          </colgroup>
          <thead>
            <tr className="border-b border-border text-[11.5px] font-medium uppercase tracking-[0.04em] text-muted">
              {["Company", "Role", "Source", "Match", "Salary", "Flags", "Status"].map((h) => (
                <th key={h} scope="col" className="h-10 px-4 font-medium first:pl-5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.isLoading &&
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  {Array.from({ length: 7 }).map((__, c) => (
                    <td key={c} className="h-[52px] px-4 first:pl-5">
                      <Skeleton className="h-3.5" style={{ width: `${55 + ((i + c * 7) % 40)}%` }} />
                    </td>
                  ))}
                </tr>
              ))}
            {jobs.data?.items.map((j, i) => (
              <Reveal as="tr" index={i} key={j.id} className={"group h-[52px] cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-hover " + (openId === j.id ? "bg-accent-tint/60" : "")}>
                <td className="px-4 pl-5" onClick={() => open(j.id)}>
                  <div className="flex items-center gap-2.5">
                    <CompanyMark name={j.company} />
                    <span className="truncate font-medium">{j.company}</span>
                  </div>
                </td>
                <td className="px-4" onClick={() => open(j.id)}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      open(j.id);
                    }}
                    className="block w-full truncate rounded-sm text-left hover:text-accent"
                    title={j.title}
                  >
                    {j.title}
                  </button>
                </td>
                <td className="truncate px-4 text-muted" onClick={() => open(j.id)}>{SOURCE_LABEL[j.source]}</td>
                <td className="px-4" onClick={() => open(j.id)}><MatchBar value={j.matchScore} /></td>
                <td className="num truncate px-4 text-[12.5px]" onClick={() => open(j.id)}>{formatSalary(j.salaryMin, j.salaryMax, j.salaryCurrency)}</td>
                <td className="px-4" onClick={() => open(j.id)}>
                  <div className="flex items-center gap-1 overflow-hidden">
                    {j.redFlags.slice(0, 1).map((f) => <FlagChip key={f.type + f.detail} flag={f} />)}
                    {j.redFlags.length > 1 && <span className="num text-[11.5px] text-muted">+{j.redFlags.length - 1}</span>}
                  </div>
                </td>
                <td className="px-4" onClick={() => open(j.id)}><StatusBadge status={j.status} /></td>
              </Reveal>
            ))}
          </tbody>
        </table>

        {jobs.isError && <ErrorState onRetry={() => jobs.refetch()} />}
        {jobs.data && jobs.data.items.length === 0 && (
          <EmptyState
            icon={Briefcase}
            title={filtered ? "No jobs match these filters" : "No jobs yet"}
            hint={filtered ? "Loosen a filter or search for something else." : "Paste a job description or turn on a loop to start collecting jobs."}
            action={filtered ? <Button onClick={reset}>Clear filters</Button> : <Button variant="primary" onClick={() => setNewJobOpen(true)}>Add a job</Button>}
          />
        )}

        {total > 0 && (
          <div className="flex h-12 items-center justify-between border-t border-border px-5 text-[12.5px] text-muted">
            <span className="num" aria-live="polite">{from}{"–"}{to} of {total}</span>
            <div className="flex items-center gap-1.5">
              <Button size="iconSm" variant="ghost" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft strokeWidth={1.5} />
              </Button>
              <span className="num w-12 text-center">{page} / {pages}</span>
              <Button size="iconSm" variant="ghost" aria-label="Next page" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight strokeWidth={1.5} />
              </Button>
            </div>
          </div>
        )}
      </Card>

      <JobDrawer jobId={openId} onClose={close} />
    </>
  );
}
