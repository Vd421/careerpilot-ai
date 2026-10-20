import { useMutation } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { LoopInput, SourceId } from "@contracts";
import { api } from "@/lib/api";
import { useSources, useVariants } from "@/lib/queries";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/lib/toast";
import { SOURCE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Chip } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/form";
import { Checkbox, Switch } from "@/components/ui/controls";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { TagInput } from "./TagInput";

export const STEPS = ["Basics", "Search", "Filters", "Resume", "Review"] as const;
export const SCHEDULES = [
  { value: "0 */6 * * *", label: "Every 6 hours" },
  { value: "0 */12 * * *", label: "Every 12 hours" },
  { value: "0 9 * * *", label: "Daily at 9:00" },
];

export interface Draft {
  name: string;
  schedule: string;
  keywords: string[];
  locations: string[];
  sources: SourceId[];
  minScore: string;
  remoteOnly: boolean;
  excludeKeywords: string[];
  inrFloor: string;
  usdFloor: string;
  resumeVariantIds: number[];
}

export const emptyDraft: Draft = {
  name: "",
  schedule: SCHEDULES[0].value,
  keywords: [],
  locations: [],
  sources: [],
  minScore: "75",
  remoteOnly: false,
  excludeKeywords: ["senior", "staff", "lead"],
  inrFloor: "",
  usdFloor: "",
  resumeVariantIds: [],
};

type Errors = Partial<Record<keyof Draft, string>>;

/** Pure so tests (and the Next button) share one rule set. */
export function validateStep(step: number, d: Draft): Errors {
  const e: Errors = {};
  if (step === 0 && !d.name.trim()) e.name = "Give the loop a name.";
  if (step === 1) {
    if (d.keywords.length === 0) e.keywords = "Add at least one keyword.";
    if (d.locations.length === 0) e.locations = "Add at least one location, e.g. Remote.";
    if (d.sources.length === 0) e.sources = "Pick at least one source.";
  }
  if (step === 2) {
    const n = Number(d.minScore);
    if (!Number.isFinite(n) || n < 0 || n > 100) e.minScore = "Enter a score from 0 to 100.";
    for (const k of ["inrFloor", "usdFloor"] as const) if (d[k] && !(Number(d[k]) >= 0)) e[k] = "Enter a positive number.";
  }
  if (step === 3 && d.resumeVariantIds.length > 2) e.resumeVariantIds = "Pick at most two variants.";
  return e;
}

export function toInput(d: Draft): LoopInput {
  const floors: Record<string, number> = {};
  if (d.inrFloor) floors.INR = Number(d.inrFloor);
  if (d.usdFloor) floors.USD = Number(d.usdFloor);
  return {
    name: d.name.trim(),
    keywords: d.keywords,
    locations: d.locations,
    sources: d.sources,
    filters: {
      minScore: Number(d.minScore),
      remoteOnly: d.remoteOnly,
      excludeKeywords: d.excludeKeywords,
      ...(Object.keys(floors).length ? { salaryFloors: floors } : {}),
    },
    resumeVariantIds: d.resumeVariantIds,
    schedule: d.schedule,
  };
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="mb-5 flex items-center gap-2" aria-label="Progress">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-2" aria-current={i === step ? "step" : undefined}>
          <span
            className={cn(
              "flex size-5 items-center justify-center rounded-full text-[11px] font-medium transition-colors",
              i < step ? "bg-accent text-white" : i === step ? "bg-accent-tint text-accent ring-1 ring-accent/40" : "bg-[#efede7] text-muted",
            )}
          >
            {i < step ? <Check className="size-3" strokeWidth={2.5} /> : i + 1}
          </span>
          <span className={cn("text-[12.5px]", i === step ? "font-medium text-text" : "text-muted")}>{s}</span>
          {i < STEPS.length - 1 && <span className="mx-1 h-px w-5 bg-border" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

function Form({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [d, setD] = useState<Draft>(emptyDraft);
  const [errors, setErrors] = useState<Errors>({});
  const sources = useSources();
  const variants = useVariants();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setD((p) => ({ ...p, [k]: v }));
    setErrors((p) => ({ ...p, [k]: undefined }));
  };

  const create = useMutation({
    mutationFn: () => api.createLoop(toInput(d)),
    onSuccess: async (loop) => {
      await qc.invalidateQueries({ queryKey: ["loops"] });
      toast("Loop created");
      onClose();
      navigate(`/loops/${loop.id}`);
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const next = () => {
    const e = validateStep(step, d);
    setErrors(e);
    if (Object.keys(e).length === 0) setStep((s) => s + 1);
  };

  const toggleSource = (id: SourceId, on: boolean) => set("sources", on ? [...d.sources, id] : d.sources.filter((s) => s !== id));
  const toggleVariant = (id: number, on: boolean) => set("resumeVariantIds", on ? [...d.resumeVariantIds, id] : d.resumeVariantIds.filter((v) => v !== id));

  const usable = (sources.data ?? []).filter((s) => s.id !== "manual");

  return (
    <DialogContent
      title="New loop"
      description="A loop searches on a schedule, scores what it finds, and sends good matches to Telegram."
      className="max-w-[640px]"
      footer={
        <>
          {step > 0 ? <Button onClick={() => setStep((s) => s - 1)} className="mr-auto">Back</Button> : <span className="mr-auto" />}
          <Button onClick={onClose}>Cancel</Button>
          {step < STEPS.length - 1 ? (
            <Button variant="primary" onClick={next}>Continue</Button>
          ) : (
            <Button variant="primary" disabled={create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? "Creating..." : "Create loop"}
            </Button>
          )}
        </>
      }
    >
      <Stepper step={step} />
      <form onSubmit={(e) => { e.preventDefault(); if (step < STEPS.length - 1) next(); }} noValidate className="min-h-[300px] space-y-4">
        {step === 0 && (
          <>
            <Field label="Name" error={errors.name} hint="Something you will recognise, like India full stack.">
              {(id) => <Input id={id} value={d.name} onChange={(e) => set("name", e.target.value)} aria-invalid={!!errors.name} autoFocus />}
            </Field>
            <Field label="Runs" hint="Sources also have their own minimum interval, so this can run less often than you pick.">
              {(id) => (
                <Select id={id} value={d.schedule} onChange={(e) => set("schedule", e.target.value)}>
                  {SCHEDULES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </Select>
              )}
            </Field>
          </>
        )}
        {step === 1 && (
          <>
            <Field label="Keywords" error={errors.keywords} hint="Press Enter after each one.">
              {(id) => <TagInput id={id} label="Keywords" value={d.keywords} onChange={(v) => set("keywords", v)} placeholder="full stack, node.js" invalid={!!errors.keywords} />}
            </Field>
            <Field label="Locations" error={errors.locations}>
              {(id) => <TagInput id={id} label="Locations" value={d.locations} onChange={(v) => set("locations", v)} placeholder="Remote, India, Pune" invalid={!!errors.locations} />}
            </Field>
            <fieldset>
              <legend className="mb-1.5 text-[12.5px] font-medium">Sources</legend>
              <div className="grid grid-cols-2 gap-1.5">
                {usable.map((s) => (
                  <label key={s.id} className={cn("flex h-9 cursor-pointer items-center gap-2.5 rounded-[8px] border border-border px-3 text-[13px] transition-colors hover:bg-hover", !s.configured && "opacity-60")}>
                    <Checkbox checked={d.sources.includes(s.id)} onCheckedChange={(v) => toggleSource(s.id, v === true)} aria-label={s.label} disabled={!s.configured} />
                    <span className="flex-1 truncate">{SOURCE_LABEL[s.id]}</span>
                    {!s.configured && <span className="text-[11px] text-muted">no key</span>}
                  </label>
                ))}
              </div>
              {errors.sources && <p role="alert" className="mt-1.5 text-[12px] text-danger">{errors.sources}</p>}
            </fieldset>
          </>
        )}
        {step === 2 && (
          <>
            <Field label="Minimum match score" error={errors.minScore} hint="Jobs scoring below this are dropped for this loop.">
              {(id) => <Input id={id} inputMode="numeric" value={d.minScore} onChange={(e) => set("minScore", e.target.value)} aria-invalid={!!errors.minScore} className="w-28" />}
            </Field>
            <Field label="Exclude title keywords" hint="Jobs with these words in the title are skipped.">
              {(id) => <TagInput id={id} label="Exclude keywords" value={d.excludeKeywords} onChange={(v) => set("excludeKeywords", v)} placeholder="senior, staff" />}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="INR yearly floor (optional)" error={errors.inrFloor}>
                {(id) => <Input id={id} inputMode="numeric" value={d.inrFloor} onChange={(e) => set("inrFloor", e.target.value)} placeholder="1200000" />}
              </Field>
              <Field label="USD yearly floor (optional)" error={errors.usdFloor}>
                {(id) => <Input id={id} inputMode="numeric" value={d.usdFloor} onChange={(e) => set("usdFloor", e.target.value)} placeholder="30000" />}
              </Field>
            </div>
            <label className="flex cursor-pointer items-center justify-between rounded-[8px] border border-border px-3 py-2.5 text-[13px]">
              <span>
                Remote only
                <span className="block text-[12px] text-muted">Skip jobs that are not remote.</span>
              </span>
              <Switch checked={d.remoteOnly} onCheckedChange={(v) => set("remoteOnly", v)} aria-label="Remote only" />
            </label>
          </>
        )}
        {step === 3 && (
          <fieldset>
            <legend className="text-[12.5px] font-medium">Resume variants</legend>
            <p className="mb-2 mt-0.5 text-[12.5px] text-muted">Pick two to A/B test which resume gets more replies. One or none is fine.</p>
            <div className="space-y-1.5">
              {(variants.data ?? []).map((v) => (
                <label key={v.id} className="flex h-10 cursor-pointer items-center gap-2.5 rounded-[8px] border border-border px-3 text-[13px] hover:bg-hover">
                  <Checkbox checked={d.resumeVariantIds.includes(v.id)} onCheckedChange={(c) => toggleVariant(v.id, c === true)} aria-label={`Variant ${v.name}`} />
                  Variant {v.name}
                </label>
              ))}
            </div>
            {errors.resumeVariantIds && <p role="alert" className="mt-1.5 text-[12px] text-danger">{errors.resumeVariantIds}</p>}
          </fieldset>
        )}
        {step === 4 && (
          <dl className="grid grid-cols-[120px_1fr] gap-y-3 text-[13px]">
            <dt className="text-muted">Name</dt><dd className="font-medium">{d.name}</dd>
            <dt className="text-muted">Schedule</dt><dd>{SCHEDULES.find((s) => s.value === d.schedule)?.label}</dd>
            <dt className="text-muted">Keywords</dt><dd className="flex flex-wrap gap-1.5">{d.keywords.map((k) => <Chip key={k}>{k}</Chip>)}</dd>
            <dt className="text-muted">Locations</dt><dd className="flex flex-wrap gap-1.5">{d.locations.map((k) => <Chip key={k}>{k}</Chip>)}</dd>
            <dt className="text-muted">Sources</dt><dd className="flex flex-wrap gap-1.5">{d.sources.map((s) => <Chip key={s}>{SOURCE_LABEL[s]}</Chip>)}</dd>
            <dt className="text-muted">Filters</dt>
            <dd className="space-y-1">
              <div>Min score {d.minScore}%{d.remoteOnly ? ", remote only" : ""}</div>
              {d.excludeKeywords.length > 0 && <div className="text-muted">Excludes: {d.excludeKeywords.join(", ")}</div>}
            </dd>
            <dt className="text-muted">Resume</dt>
            <dd>{d.resumeVariantIds.length === 0 ? "Default resume" : d.resumeVariantIds.map((id) => <Badge key={id} tone="accent" className="mr-1.5">Variant {variants.data?.find((v) => v.id === id)?.name}</Badge>)}</dd>
          </dl>
        )}
      </form>
    </DialogContent>
  );
}

export function LoopFormDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>{open && <Form onClose={() => onOpenChange(false)} />}</Dialog>;
}
