import { useMutation } from "@tanstack/react-query";
import { Check, ExternalLink, FileText, Send, SkipForward, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { DisplayStatus, JobDetail, ResumeVersionItem } from "@contracts";
import { api } from "@/lib/api";
import { useInvalidateAll, useJob } from "@/lib/queries";
import { useToast } from "@/lib/toast";
import { formatDate, formatSalary, SOURCE_LABEL, MANUAL_REASON_LABEL } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge, Chip, StatusBadge } from "@/components/ui/badge";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/card";
import { Drawer } from "@/components/ui/overlay";
import { Tabs, TabsContent, TabsList, TabsTrigger, MatchBar } from "@/components/ui/controls";
import { FlagChip } from "./parts";

const SKIPPABLE: DisplayStatus[] = ["discovered", "scored", "pushed", "pending_approval", "needs_answers", "filtered_out"];
const TELEGRAM_WAIT: DisplayStatus[] = ["pending_approval", "needs_answers", "approved"];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="py-4">
      <h3 className="mb-2.5 text-[11.5px] font-medium uppercase tracking-[0.04em] text-muted">{title}</h3>
      {children}
    </section>
  );
}

export function ResumePreview({ version }: { version: ResumeVersionItem }) {
  const t = version.tailored;
  return (
    <div className="rounded-[10px] border border-border bg-[#fdfdfb] p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone="accent">Variant {version.variantName ?? "default"}</Badge>
          <span className="text-[12px] text-muted">Tailored {formatDate(version.createdAt)}</span>
        </div>
        {version.pdfUrl && (
          <a
            href={version.pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 items-center gap-1.5 rounded-[8px] border border-border bg-surface px-2.5 text-[12.5px] font-medium shadow-card hover:bg-[#fbfaf8]"
          >
            <FileText className="size-[14px]" strokeWidth={1.5} /> Open PDF
          </a>
        )}
      </div>
      {t.headline && <p className="mb-4 text-[13.5px] leading-relaxed">{t.headline}</p>}
      {t.sections.map((s) => (
        <div key={s.sourceId} className="mb-4">
          <h4 className="mb-1.5 text-[12.5px] font-semibold capitalize">{s.sourceId.replace(/^(exp|proj)-/, "").replace(/-/g, " ")}</h4>
          <ul className="space-y-1.5">
            {s.bullets.map((b) => (
              <li key={b.sourceBulletId} className="flex gap-2 text-[13px] leading-relaxed">
                <span className="mt-[9px] size-1 shrink-0 rounded-full bg-[#a39f95]" aria-hidden />
                <span>
                  {b.text}
                  <span className="num ml-1.5 text-[10.5px] text-[#a39f95]" title="The original resume bullet this was reworded from">
                    {b.sourceBulletId}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {t.skillsOrder.length > 0 && (
        <div className="mb-1">
          <h4 className="mb-1.5 text-[12.5px] font-semibold">Skills</h4>
          <div className="flex flex-wrap gap-1.5">
            {t.skillsOrder.map((s) => (
              <Chip key={s}>{s}</Chip>
            ))}
          </div>
        </div>
      )}
      {t.coverNote && (
        <div className="mt-4 border-t border-border pt-3">
          <h4 className="mb-1 text-[12.5px] font-semibold">Cover note</h4>
          <p className="text-[13px] leading-relaxed text-[#4a4843]">{t.coverNote}</p>
        </div>
      )}
    </div>
  );
}

function DrawerBody({ job }: { job: JobDetail }) {
  const invalidate = useInvalidateAll();
  const toast = useToast();
  const push = useMutation({
    mutationFn: () => api.pushJob(job.id),
    onSuccess: async () => {
      await invalidate();
      toast("Card sent to Telegram");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const tailor = useMutation({
    mutationFn: () => api.tailorJob(job.id),
    onSuccess: async () => {
      await invalidate();
      toast("Resume tailored");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const skip = useMutation({
    mutationFn: () => api.skipJob(job.id),
    onSuccess: async () => {
      await invalidate();
      toast("Skipped");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const latest = job.resumeVersions[0];
  const waiting = TELEGRAM_WAIT.includes(job.status);
  const canPush = job.applicationId == null && job.status !== "skipped";
  const app = job.application;

  return (
    <div className="px-6 pb-8">
      {/* Summary strip */}
      <div className="flex items-center justify-between gap-4 py-4">
        <div className="flex items-center gap-3">
          <StatusBadge status={job.status} />
          <MatchBar value={job.matchScore} />
        </div>
        <div className="num text-[13px] text-muted">{formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency)}</div>
      </div>

      {/* Actions. Approving or submitting is deliberately not here: that happens on Telegram. */}
      <div className="flex flex-wrap items-center gap-2 border-y border-border py-3">
        {canPush && (
          <Button variant="primary" onClick={() => push.mutate()} disabled={push.isPending}>
            <Send strokeWidth={1.5} /> {push.isPending ? "Sending..." : "Send to Telegram"}
          </Button>
        )}
        <Button onClick={() => tailor.mutate()} disabled={tailor.isPending}>
          <Sparkles strokeWidth={1.5} /> {tailor.isPending ? "Tailoring..." : latest ? "Re-tailor resume" : "Tailor resume"}
        </Button>
        {SKIPPABLE.includes(job.status) && (
          <Button variant="ghost" onClick={() => skip.mutate()} disabled={skip.isPending}>
            <SkipForward strokeWidth={1.5} /> Skip
          </Button>
        )}
        {waiting && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-[12.5px] text-muted">
            <Check className="size-[14px] text-success" strokeWidth={1.75} /> Approve on Telegram
          </span>
        )}
      </div>

      <Tabs defaultValue="fit" className="mt-1">
        <TabsList className="w-full">
          <TabsTrigger value="fit">Fit</TabsTrigger>
          <TabsTrigger value="resume">Resume</TabsTrigger>
          <TabsTrigger value="description">Description</TabsTrigger>
        </TabsList>

        <TabsContent value="fit" className="divide-y divide-border outline-none">
          {job.summary ? (
            <Section title="Why it fits">
              <p className="text-[13.5px] leading-relaxed">{job.summary}</p>
            </Section>
          ) : (
            <Section title="Why it fits">
              <p className="text-[13px] text-muted">Not scored yet. Scoring runs in the background and this will fill in.</p>
            </Section>
          )}
          <Section title="Skills">
            <div className="space-y-3">
              <div>
                <p className="mb-1.5 text-[12.5px] text-muted">Matched</p>
                <div className="flex flex-wrap gap-1.5">
                  {job.matchedSkills.length ? job.matchedSkills.map((s) => <Badge key={s} tone="success">{s}</Badge>) : <span className="text-[13px] text-muted">{job.matchScore == null ? "Not scored yet" : "None"}</span>}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-[12.5px] text-muted">Missing</p>
                <div className="flex flex-wrap gap-1.5">
                  {job.missingSkills.length ? job.missingSkills.map((s) => <Badge key={s} tone="warning">{s}</Badge>) : <span className="text-[13px] text-muted">{job.matchScore == null ? "Not scored yet" : "Nothing major"}</span>}
                </div>
              </div>
            </div>
          </Section>
          <Section title="Red flags">
            {job.redFlags.length === 0 && job.filterReasons.length === 0 ? (
              <p className="text-[13px] text-muted">No red flags found.</p>
            ) : (
              <ul className="space-y-2">
                {job.redFlags.map((f) => (
                  <li key={f.type + f.detail} className="flex items-center gap-2.5 text-[13px]">
                    <FlagChip flag={f} />
                    <span className="text-[#4a4843]">{f.detail}</span>
                  </li>
                ))}
                {job.filterReasons.length > 0 && (
                  <li className="text-[13px] text-muted">Dropped because: {job.filterReasons.join("; ")}</li>
                )}
              </ul>
            )}
          </Section>
          <Section title="Details">
            <dl className="grid grid-cols-[96px_1fr] gap-y-2 text-[13px]">
              <dt className="text-muted">Location</dt>
              <dd>{job.location ?? "-"}{job.remote ? " (remote)" : ""}</dd>
              <dt className="text-muted">Source</dt>
              <dd>{SOURCE_LABEL[job.source]}</dd>
              <dt className="text-muted">Apply via</dt>
              <dd className="capitalize">{job.applyPlatform}{job.applyPlatform === "other" ? " (manual)" : ""}</dd>
              {app && (
                <>
                  <dt className="text-muted">Application</dt>
                  <dd>
                    <Link to={`/applications?app=${app.id}`} className="rounded-sm text-accent hover:underline">
                      {app.method === "manual" && app.manualReason ? MANUAL_REASON_LABEL[app.manualReason] : "View application"}
                    </Link>
                  </dd>
                </>
              )}
            </dl>
            <div className="mt-3 flex items-center justify-between gap-3">
              {job.attribution ? <span className="text-[12px] text-muted">{job.attribution}</span> : <span />}
              {job.url && (
                <a href={job.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-sm text-[12.5px] font-medium text-accent hover:underline">
                  View posting <ExternalLink className="size-[13px]" strokeWidth={1.5} />
                </a>
              )}
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="resume" className="pt-4 outline-none">
          {latest ? (
            <ResumePreview version={latest} />
          ) : (
            <EmptyState
              icon={FileText}
              title="No tailored resume yet"
              hint="Tailoring rewords your real bullets for this job. It never adds experience you do not have."
              action={
                <Button variant="primary" onClick={() => tailor.mutate()} disabled={tailor.isPending}>
                  <Sparkles strokeWidth={1.5} /> Tailor resume
                </Button>
              }
            />
          )}
        </TabsContent>

        <TabsContent value="description" className="pt-4 outline-none">
          <div className="max-h-[520px] overflow-y-auto whitespace-pre-wrap rounded-[10px] border border-border bg-[#fdfdfb] p-4 text-[13px] leading-relaxed text-[#3a3834]">
            {job.description}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function JobDrawer({ jobId, onClose }: { jobId: number | null; onClose: () => void }) {
  const { data, isLoading, isError, refetch } = useJob(jobId);
  return (
    <Drawer
      open={jobId != null}
      onOpenChange={(o) => !o && onClose()}
      title={data ? data.title : "Job"}
      subtitle={data ? `${data.company} · ${data.location ?? "Location not listed"}` : "Loading..."}
    >
      {isLoading ? (
        <div className="space-y-4 p-6">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-9" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : isError || !data ? (
        <ErrorState message="Could not load this job." onRetry={() => refetch()} />
      ) : (
        <DrawerBody job={data} />
      )}
    </Drawer>
  );
}
