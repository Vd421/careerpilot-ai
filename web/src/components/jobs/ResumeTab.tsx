import { useMutation } from "@tanstack/react-query";
import { ArrowUp, FileText, History, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { JobDetail, ResumeChatMessageItem, ResumeVersionItem } from "@contracts";
import { api } from "@/lib/api";
import { useInvalidateAll, useResumeChat } from "@/lib/queries";
import { useToast } from "@/lib/toast";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/card";
import { Badge, Chip } from "@/components/ui/badge";

const SENT = ["applied", "replied", "interview", "rejected", "offer"];
const SUGGESTIONS = ["Lead with backend and API work", "Make it shorter", "Drop the cover note", "Use the job's wording more"];

/** "v3 · Refined: make it shorter" — numbered oldest first, so v1 is the first tailor. */
export function versionLabel(v: ResumeVersionItem, n: number): string {
  if (v.instruction) return `v${n} · Refined: ${v.instruction.length > 40 ? v.instruction.slice(0, 40) + "…" : v.instruction}`;
  if (v.parentId) return `v${n} · Restored`;
  return `v${n} · Tailored`;
}

export function ResumeTab({ job }: { job: JobDetail }) {
  const versions = job.resumeVersions; // newest first
  const active = versions.find((v) => v.active) ?? versions[0];
  const numberOf = new Map([...versions].reverse().map((v, i) => [v.id, i + 1]));
  const [viewingId, setViewingId] = useState(active.id);
  // A new version (from chat, restore or re-tailor) becomes the one shown.
  useEffect(() => setViewingId(active.id), [active.id]);
  const viewing = versions.find((v) => v.id === viewingId) ?? active;
  const locked = job.application != null && SENT.includes(job.application.status);

  const invalidate = useInvalidateAll();
  const toast = useToast();
  const restore = useMutation({
    mutationFn: () => api.restoreVersion(viewing.id),
    onSuccess: async () => {
      await invalidate();
      toast(`Version ${numberOf.get(viewing.id)} is current again`);
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  return (
    <div className="space-y-4">
      {!locked && <RefineChat job={job} onShowVersion={setViewingId} />}

      {versions.length > 1 && (
        <div className="flex items-center gap-2.5">
          <History className="size-[15px] shrink-0 text-muted" strokeWidth={1.5} aria-hidden />
          <div className="min-w-0 flex-1">
            <Select aria-label="Resume version" value={viewing.id} onChange={(e) => setViewingId(Number(e.target.value))}>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {versionLabel(v, numberOf.get(v.id)!)}
                  {v.active ? " (current)" : ""}
                </option>
              ))}
            </Select>
          </div>
        </div>
      )}

      {!viewing.active && (
        <div className="flex items-center justify-between gap-3 rounded-[10px] border border-border bg-[#f7f6f2] px-4 py-2.5 text-[12.5px]">
          <span className="text-muted">You're looking at an older version. Applications use the current one.</span>
          {!locked && (
            <Button size="sm" onClick={() => restore.mutate()} disabled={restore.isPending}>
              {restore.isPending ? "Restoring..." : "Make current"}
            </Button>
          )}
        </div>
      )}

      <ResumePreview version={viewing} />
      {locked && <p className="text-[12.5px] text-muted">This application was already sent, so its resume is final.</p>}
    </div>
  );
}

function RefineChat({ job, onShowVersion }: { job: JobDetail; onShowVersion: (id: number) => void }) {
  const chat = useResumeChat(job.id);
  const invalidate = useInvalidateAll();
  const toast = useToast();
  const [text, setText] = useState("");
  const [pendingText, setPendingText] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const refine = useMutation({
    mutationFn: (message: string) => api.refineResume(job.id, { message }),
    onMutate: (message) => {
      setPendingText(message);
      setText("");
    },
    onSuccess: () => invalidate(),
    onError: (e: Error, message) => {
      setText(message); // give the words back so nothing is lost
      toast(e.message, "error");
    },
    onSettled: () => setPendingText(null),
  });

  const messages: ResumeChatMessageItem[] = chat.data ?? [];
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, pendingText]);

  const send = (message = text) => {
    const m = message.trim();
    if (m && !refine.isPending) refine.mutate(m);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };
  const empty = messages.length === 0 && !pendingText;

  return (
    <section className="rounded-[10px] border border-border bg-surface shadow-card" aria-label="Refine the resume with chat">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Sparkles className="size-[15px] text-accent" strokeWidth={1.5} aria-hidden />
        <h3 className="text-[13px] font-semibold">Refine with chat</h3>
        <span className="ml-auto text-[11.5px] text-muted">Rewords and reorders only</span>
      </header>

      {chat.isLoading ? (
        <div className="space-y-2 px-4 py-3">
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3.5 w-1/2" />
        </div>
      ) : empty ? (
        <div className="px-4 py-3">
          <p className="mb-2.5 text-[12.5px] text-muted">
            Tell it what to change. It can't add skills, numbers or experience your resume doesn't have.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="h-7 rounded-full border border-border bg-[#fbfaf8] px-3 text-[12.5px] text-text transition-colors hover:border-[#d6d3cb] hover:bg-hover"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div ref={listRef} role="log" aria-live="polite" className="max-h-64 space-y-2.5 overflow-y-auto px-4 py-3">
          {messages.map((m) => (
            <Message key={m.id} m={m} onShowVersion={onShowVersion} />
          ))}
          {pendingText && (
            <>
              <Message m={{ id: -1, role: "user", text: pendingText, resumeVersionId: null, createdAt: "" }} onShowVersion={onShowVersion} />
              <div className="flex items-center gap-2 text-[12.5px] text-muted">
                <Skeleton className="h-3 w-24" /> Rewriting from your real bullets
              </div>
            </>
          )}
        </div>
      )}

      <div className="flex items-end gap-2 border-t border-border px-3 py-2.5">
        <Textarea
          aria-label="What should change?"
          placeholder="e.g. Put the AI projects first"
          rows={1}
          maxLength={1000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          className="max-h-28 min-h-9 resize-none py-2"
        />
        <Button variant="primary" size="icon" aria-label="Send" onClick={() => send()} disabled={!text.trim() || refine.isPending}>
          <ArrowUp strokeWidth={1.75} />
        </Button>
      </div>
    </section>
  );
}

function Message({ m, onShowVersion }: { m: ResumeChatMessageItem; onShowVersion: (id: number) => void }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-[10px] bg-accent-tint px-3 py-2 text-[13px] leading-relaxed">{m.text}</p>
      </div>
    );
  }
  return (
    <div className="max-w-[92%] text-[13px] leading-relaxed text-[#3a3834]">
      <p className="whitespace-pre-wrap">{m.text}</p>
      {m.resumeVersionId != null && (
        <button
          onClick={() => onShowVersion(m.resumeVersionId!)}
          className={cn("mt-0.5 rounded-sm text-[12px] font-medium text-accent hover:underline")}
        >
          View this version{m.createdAt ? ` · ${formatDate(m.createdAt)}` : ""}
        </button>
      )}
    </div>
  );
}

export function ResumePreview({ version }: { version: ResumeVersionItem }) {
  const t = version.tailored;
  return (
    <div className="rounded-[10px] border border-border bg-[#fdfdfb] p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone="accent">Variant {version.variantName ?? "default"}</Badge>
          <span className="text-[12px] text-muted">
            {version.instruction ? "Refined" : version.parentId ? "Restored" : "Tailored"} {formatDate(version.createdAt)}
          </span>
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

