import { useMutation } from "@tanstack/react-query";
import { CheckCheck, ExternalLink, FileText, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import type { ApplicationDetail } from "@contracts";
import { api } from "@/lib/api";
import { useApplication, useInvalidateAll } from "@/lib/queries";
import { useToast } from "@/lib/toast";
import { formatDate, MANUAL_REASON_LABEL } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/controls";
import { ErrorState, Skeleton } from "@/components/ui/card";
import { Drawer } from "@/components/ui/overlay";
import { ScreenshotThumb } from "./Screenshot";

function Body({ app }: { app: ApplicationDetail }) {
  const invalidate = useInvalidateAll();
  const toast = useToast();
  const mark = useMutation({
    mutationFn: () => api.markApplied(app.id),
    onSuccess: async () => {
      await invalidate();
      toast("Marked as applied");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const isManual = app.status === "manual";
  const answered = app.questions.filter((q) => q.answer);

  return (
    <div className="space-y-6 px-6 pb-8 pt-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <StatusBadge status={app.status} />
          {app.method && app.status !== "manual" && <Badge>{app.method === "auto" ? "Auto-filled" : "Manual"}</Badge>}
        </div>
        <Link to={`/jobs?job=${app.jobId}`} className="rounded-sm text-[12.5px] font-medium text-accent hover:underline">
          View job
        </Link>
      </div>

      {(app.status === "pending_approval" || app.status === "approved" || app.status === "needs_answers") && (
        <p className="flex items-center gap-2 rounded-[8px] bg-accent-tint px-3 py-2.5 text-[13px] text-accent">
          <ShieldCheck className="size-[15px] shrink-0" strokeWidth={1.5} />
          {app.status === "needs_answers" ? "Waiting on your answers in Questions or on Telegram." : "Approve on Telegram. Nothing is submitted without your tap."}
        </p>
      )}

      {isManual && (
        <div className="rounded-[10px] border border-border bg-[#fdfaf3] p-4">
          <p className="text-[13.5px] font-medium">Apply by hand</p>
          <p className="mt-0.5 text-[13px] text-muted">{app.manualReason ? MANUAL_REASON_LABEL[app.manualReason] : "This one could not be auto-filled."}. Everything you need is below.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {app.applyUrl && (
              <a href={app.applyUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover">
                Open application <ExternalLink className="size-[14px]" strokeWidth={1.5} />
              </a>
            )}
            <Button onClick={() => mark.mutate()} disabled={mark.isPending}>
              <CheckCheck strokeWidth={1.5} /> I applied
            </Button>
          </div>
        </div>
      )}

      <dl className="grid grid-cols-[110px_1fr] gap-y-2.5 text-[13px]">
        <dt className="text-muted">Resume used</dt>
        <dd className="flex items-center gap-2">
          {app.variantName ? <Badge tone="accent">Variant {app.variantName}</Badge> : <span className="text-muted">Not tailored yet</span>}
          {app.pdfUrl && (
            <a href={app.pdfUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-sm text-accent hover:underline">
              <FileText className="size-[13px]" strokeWidth={1.5} /> PDF
            </a>
          )}
        </dd>
        <dt className="text-muted">Applied</dt>
        <dd className="num">{formatDate(app.appliedAt)}</dd>
        <dt className="text-muted">Created</dt>
        <dd className="num">{formatDate(app.createdAt)}</dd>
      </dl>

      {app.screenshotUrl && (
        <section>
          <h3 className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.04em] text-muted">Screenshot</h3>
          <ScreenshotThumb url={app.screenshotUrl} label={`${app.company}`} className="h-28 w-40" />
        </section>
      )}

      <section>
        <h3 className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.04em] text-muted">Form answers</h3>
        {answered.length === 0 ? (
          <p className="text-[13px] text-muted">No custom questions were asked for this form.</p>
        ) : (
          <ul className="divide-y divide-border rounded-[10px] border border-border">
            {answered.map((q) => {
              const text = q.answer?.polishedAnswer ?? q.answer?.rawAnswer ?? "";
              return (
                <li key={q.id} className="p-3.5">
                  <p className="text-[12.5px] text-muted">{q.text}</p>
                  <div className="mt-1 flex items-start justify-between gap-3">
                    <p className="text-[13.5px] leading-relaxed">{text}</p>
                    {isManual && <CopyButton text={text} />}
                  </div>
                  {!q.answer?.approved && <Badge tone="warning" className="mt-2">Not approved yet</Badge>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

export function ApplicationDrawer({ appId, onClose }: { appId: number | null; onClose: () => void }) {
  const { data, isLoading, isError, refetch } = useApplication(appId);
  return (
    <Drawer open={appId != null} onOpenChange={(o) => !o && onClose()} title={data ? data.title : "Application"} subtitle={data ? data.company : "Loading..."}>
      {isLoading ? (
        <div className="space-y-4 p-6">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-24" />
          <Skeleton className="h-32" />
        </div>
      ) : isError || !data ? (
        <ErrorState message="Could not load this application." onRetry={() => refetch()} />
      ) : (
        <Body app={data} />
      )}
    </Drawer>
  );
}

