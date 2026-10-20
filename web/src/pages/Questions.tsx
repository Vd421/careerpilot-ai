import { useMutation } from "@tanstack/react-query";
import { Check, MessageSquareText, Pencil, Trash2, Wand2 } from "lucide-react";
import { useState } from "react";
import type { AnswerItem, QuestionItem } from "@contracts";
import { api } from "@/lib/api";
import { useAnswers, useInvalidateAll, useQuestions, qk } from "@/lib/queries";
import { useDocumentTitle } from "@/lib/hooks";
import { useToast } from "@/lib/toast";
import { timeAgo } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, Textarea } from "@/components/ui/form";
import { Segmented, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/controls";
import { ConfirmDialog } from "@/components/ui/overlay";
import { Reveal } from "@/components/motion";

/* ------------------------------ Pending ------------------------------ */

function PendingCard({ q, index }: { q: QuestionItem; index: number }) {
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const [raw, setRaw] = useState(q.answer?.rawAnswer ?? "");
  const [polished, setPolished] = useState<string | null>(q.answer && !q.answer.approved ? q.answer.polishedAnswer : null);
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState("");
  const [reusable, setReusable] = useState(false);
  const choices = q.fieldType === "select" || q.fieldType === "radio" ? q.options : null;

  const polish = useMutation({
    mutationFn: () => api.answerQuestion(q.id, raw),
    onSuccess: (r) => setPolished(r.polished),
    onError: (e: Error) => toast(e.message, "error"),
  });
  const approve = useMutation({
    mutationFn: (choice: "polished" | "original" | "edited") =>
      api.approveQuestion(q.id, { choice, edited: choice === "edited" ? edited : undefined, reusable }),
    onSuccess: async () => {
      await invalidate();
      toast(reusable ? "Answer saved for future jobs" : "Answer saved");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const reviewing = polished != null;

  return (
    <Reveal index={index}>
      <Card className="p-5" aria-label={q.text}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11.5px] text-muted">
              {q.company} {"·"} {q.jobTitle}
            </p>
            <h3 className="mt-1 text-[15px] leading-snug">{q.text}</h3>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {q.required && <Badge tone="warning">Required</Badge>}
            <span className="num text-[11.5px] text-muted">{timeAgo(q.createdAt)}</span>
          </div>
        </div>

        {!reviewing ? (
          <div className="mt-4 space-y-3">
            {choices ? (
              <Select aria-label="Your answer" value={raw} onChange={(e) => setRaw(e.target.value)}>
                <option value="">Choose an option</option>
                {choices.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </Select>
            ) : (
              <Textarea aria-label="Your answer" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="Write it roughly. I will only fix grammar and tone, never add facts." rows={3} />
            )}
            <div className="flex items-center justify-between">
              <p className="text-[12px] text-muted">Also waiting on Telegram. Answer in either place.</p>
              <Button variant="primary" disabled={!raw.trim() || polish.isPending} onClick={() => polish.mutate()}>
                <Wand2 strokeWidth={1.5} /> {polish.isPending ? "Polishing..." : "Polish answer"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-[8px] border border-border bg-[#fbfaf8] p-3">
                <p className="mb-1 text-[11.5px] font-medium uppercase tracking-[0.04em] text-muted">Your words</p>
                <p className="text-[13.5px] leading-relaxed">{q.answer?.rawAnswer ?? raw}</p>
              </div>
              <div className="rounded-[8px] border border-accent/30 bg-accent-tint/50 p-3">
                <p className="mb-1 text-[11.5px] font-medium uppercase tracking-[0.04em] text-accent">Polished</p>
                {editing ? (
                  <Textarea aria-label="Edit polished answer" value={edited} onChange={(e) => setEdited(e.target.value)} rows={3} className="bg-white" autoFocus />
                ) : (
                  <p className="text-[13.5px] leading-relaxed">{polished}</p>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between gap-4">
              <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
                <Switch checked={reusable} onCheckedChange={setReusable} aria-label="Save for future jobs" />
                Save for future jobs
              </label>
              <div className="flex items-center gap-2">
                {editing ? (
                  <>
                    <Button onClick={() => setEditing(false)}>Cancel</Button>
                    <Button variant="primary" disabled={!edited.trim() || approve.isPending} onClick={() => approve.mutate("edited")}>
                      <Check strokeWidth={1.75} /> Save edit
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="ghost" onClick={() => approve.mutate("original")} disabled={approve.isPending}>Use my original</Button>
                    <Button
                      onClick={() => {
                        setEdited(polished ?? "");
                        setEditing(true);
                      }}
                    >
                      <Pencil strokeWidth={1.5} /> Edit
                    </Button>
                    <Button variant="primary" onClick={() => approve.mutate("polished")} disabled={approve.isPending}>
                      <Check strokeWidth={1.75} /> Use
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </Card>
    </Reveal>
  );
}

function Pending() {
  const { data, isLoading, isError, refetch } = useQuestions();
  const pending = data?.filter((q) => q.status !== "answered") ?? [];
  if (isLoading)
    return (
      <div className="space-y-4">
        {[0, 1].map((i) => (
          <Card key={i} className="space-y-3 p-5">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-20" />
          </Card>
        ))}
      </div>
    );
  if (isError) return <Card><ErrorState onRetry={() => refetch()} /></Card>;
  if (pending.length === 0)
    return (
      <Card>
        <EmptyState icon={MessageSquareText} title="No questions waiting" hint="When a form asks something that is not in your answer bank, it appears here and on Telegram." />
      </Card>
    );
  return (
    <div className="space-y-4">
      {pending.map((q, i) => (
        <PendingCard key={q.id} q={q} index={i} />
      ))}
    </div>
  );
}

/* ---------------------------- Answer bank ---------------------------- */

function BankRow({ a }: { a: AnswerItem }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(a.polishedAnswer ?? a.rawAnswer);
  const [confirm, setConfirm] = useState(false);

  const update = useMutation({
    mutationFn: (patch: Partial<AnswerItem>) => api.updateAnswer(a.id, patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: qk.answers });
      const prev = qc.getQueryData<AnswerItem[]>(qk.answers);
      qc.setQueryData<AnswerItem[]>(qk.answers, (old) => old?.map((x) => (x.id === a.id ? { ...x, ...patch } : x)));
      return { prev };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.answers, ctx.prev);
      toast(e.message, "error");
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.answers }),
  });
  const del = useMutation({
    mutationFn: () => api.deleteAnswer(a.id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.answers });
      toast("Answer deleted");
    },
  });

  return (
    <li className="px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-muted">{a.questionText}</p>
          {editing ? (
            <div className="mt-2 space-y-2">
              <Textarea aria-label="Edit answer" value={text} onChange={(e) => setText(e.target.value)} rows={3} autoFocus />
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!text.trim()}
                  onClick={() => {
                    update.mutate({ polishedAnswer: text.trim() });
                    setEditing(false);
                  }}
                >
                  Save
                </Button>
                <Button size="sm" onClick={() => { setText(a.polishedAnswer ?? a.rawAnswer); setEditing(false); }}>Cancel</Button>
              </div>
            </div>
          ) : (
            <p className="mt-1 text-[14px] leading-relaxed">{a.polishedAnswer ?? a.rawAnswer}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {!a.approved && <Badge tone="warning">Not approved</Badge>}
            {a.key && <span className="num rounded bg-[#f1f0ea] px-1.5 py-0.5 text-[11px] text-muted">{a.key}</span>}
            {a.tags.filter((t) => t !== a.key).map((t) => <Badge key={t}>{t.replace(/_/g, " ")}</Badge>)}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-muted">
            Reusable
            <Switch checked={a.reusable} onCheckedChange={(v) => update.mutate({ reusable: v })} aria-label={`Reusable: ${a.questionText}`} />
          </label>
          <Button size="iconSm" variant="ghost" aria-label="Edit answer" onClick={() => setEditing(true)}><Pencil strokeWidth={1.5} /></Button>
          <Button size="iconSm" variant="ghost" aria-label="Delete answer" onClick={() => setConfirm(true)}><Trash2 strokeWidth={1.5} /></Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Delete this answer?"
        description="It will no longer be reused on future forms. Past applications keep what was submitted."
        confirmLabel="Delete"
        danger
        onConfirm={() => del.mutate()}
      />
    </li>
  );
}

function Bank() {
  const { data, isLoading, isError, refetch } = useAnswers();
  const [filter, setFilter] = useState<"all" | "reusable" | "specific">("all");
  const rows = (data ?? []).filter((a) => (filter === "all" ? true : filter === "reusable" ? a.reusable : !a.reusable));
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[13px] text-muted">Facts reused on every form: notice period, location, links. Edit anything here.</p>
        <Segmented
          label="Filter answers"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "reusable", label: "Reusable" },
            { value: "specific", label: "Job-specific" },
          ]}
        />
      </div>
      <Card>
        {isLoading ? (
          <div className="space-y-5 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon={MessageSquareText} title="No answers here" hint="Approved answers you mark as reusable are saved here." action={filter !== "all" ? <Button onClick={() => setFilter("all")}>Show all answers</Button> : undefined} />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((a) => (
              <BankRow key={a.id} a={a} />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

export default function QuestionsPage() {
  useDocumentTitle("Questions");
  const { data } = useQuestions();
  const count = data?.filter((q) => q.status !== "answered").length ?? 0;
  return (
    <>
      <PageHeader title="Questions" description="Form questions that need you, and the answers the agent can reuse." />
      <Tabs defaultValue="pending">
        <TabsList className="mb-5">
          <TabsTrigger value="pending">
            Pending {count > 0 && <span className="num ml-1 rounded-full bg-[#f6eedd] px-1.5 py-px text-[11px] text-warning">{count}</span>}
          </TabsTrigger>
          <TabsTrigger value="bank">Answer bank</TabsTrigger>
        </TabsList>
        <TabsContent value="pending" className="outline-none"><Pending /></TabsContent>
        <TabsContent value="bank" className="outline-none"><Bank /></TabsContent>
      </Tabs>
    </>
  );
}
