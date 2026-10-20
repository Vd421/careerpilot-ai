import { AlertTriangle, Check } from "lucide-react";
import { useState, type ReactNode } from "react";
import { HARD_DAILY_CAP, type SettingsDto } from "@contracts";
import { useSettings, useSources, useStatus, useUpdateSettings } from "@/lib/queries";
import { useDocumentTitle } from "@/lib/hooks";
import { useToast } from "@/lib/toast";
import { SOURCE_LABEL } from "@/lib/format";
import { Card, CardHeader, ErrorState, PageHeader, Skeleton } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input } from "@/components/ui/form";
import { Switch } from "@/components/ui/controls";
import { ConfirmDialog } from "@/components/ui/overlay";
import { cn } from "@/lib/utils";

function Row({ title, hint, children, className }: { title: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-8 px-5 py-4", className)}>
      <div className="min-w-0">
        <p className="text-[13.5px] font-medium">{title}</p>
        {hint && <p className="mt-0.5 text-[12.5px] text-muted">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const CURRENCIES = ["INR", "USD", "EUR", "GBP"];

interface FormState {
  floors: Record<string, string>;
  noticeDays: string;
  matchThreshold: string;
  maxYearsRequired: string;
  dailyCap: string;
}

const toForm = (s: SettingsDto): FormState => ({
  floors: Object.fromEntries([...new Set([...CURRENCIES, ...Object.keys(s.salaryFloors)])].map((c) => [c, s.salaryFloors[c] != null ? String(s.salaryFloors[c]) : ""])),
  noticeDays: String(s.noticeDays),
  matchThreshold: String(s.matchThreshold),
  maxYearsRequired: String(s.maxYearsRequired),
  dailyCap: String(s.dailyCap),
});

export function validateSettings(f: FormState): Record<string, string> {
  const e: Record<string, string> = {};
  const int = (k: keyof FormState, min: number, max: number, msg: string) => {
    const n = Number(f[k as "noticeDays"]);
    if (!Number.isInteger(n) || n < min || n > max) e[k] = msg;
  };
  int("matchThreshold", 0, 100, "Enter 0 to 100.");
  int("noticeDays", 0, 365, "Enter 0 to 365 days.");
  int("maxYearsRequired", 0, 30, "Enter 0 to 30 years.");
  int("dailyCap", 1, HARD_DAILY_CAP, `Between 1 and ${HARD_DAILY_CAP}. ${HARD_DAILY_CAP} is a hard maximum.`);
  for (const [c, v] of Object.entries(f.floors)) if (v && !(Number(v) >= 0)) e[`floor-${c}`] = "Enter a positive number.";
  return e;
}

function SettingsForm({ settings }: { settings: SettingsDto }) {
  const update = useUpdateSettings();
  const sources = useSources();
  const status = useStatus();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(() => toForm(settings));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmLive, setConfirmLive] = useState(false);

  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(settings));
  const setF = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((p) => ({ ...p, [k]: v }));

  function save() {
    const e = validateSettings(form);
    setErrors(e);
    if (Object.keys(e).length) return;
    update.mutate(
      {
        salaryFloors: Object.fromEntries(Object.entries(form.floors).filter(([, v]) => v !== "").map(([c, v]) => [c, Number(v)])),
        noticeDays: Number(form.noticeDays),
        matchThreshold: Number(form.matchThreshold),
        maxYearsRequired: Number(form.maxYearsRequired),
        dailyCap: Number(form.dailyCap),
      },
      { onSuccess: () => toast("Settings saved"), onError: (err) => toast(err.message, "error") },
    );
  }

  return (
    <div className="space-y-6">
      {/* Safety */}
      <Card>
        <CardHeader title="Safety" />
        <div className="divide-y divide-border">
          <Row
            title="Dry run"
            hint={settings.dryRun ? "Forms are filled and screenshotted, but nothing is submitted." : "Live. Applications are submitted after you approve on Telegram."}
          >
            <Switch
              checked={settings.dryRun}
              aria-label="Dry run"
              onCheckedChange={(on) => (on ? update.mutate({ dryRun: true }) : setConfirmLive(true))}
            />
          </Row>
          {!settings.dryRun && (
            <div className="flex items-start gap-2.5 bg-[#f6eedd] px-5 py-3 text-[13px] text-warning">
              <AlertTriangle className="mt-0.5 size-[15px] shrink-0" strokeWidth={1.5} />
              Dry run is off. Nothing is ever submitted without your tap on Telegram, but a tap now sends a real application.
            </div>
          )}
          <Row title="Daily application cap" hint={`Applications per day. The hard maximum is ${HARD_DAILY_CAP}.`}>
            <Field label="Daily cap" error={errors.dailyCap} className="w-28 [&>label]:sr-only">
              {(id) => <Input id={id} inputMode="numeric" value={form.dailyCap} onChange={(e) => setF("dailyCap", e.target.value)} aria-invalid={!!errors.dailyCap} className="num text-right" />}
            </Field>
          </Row>
          <Row title="Telegram" hint="Approvals and questions are sent to your chat.">
            <div className="flex items-center gap-2 text-[13px]">
              <span className={cn("size-2 rounded-full", status.data?.telegramConnected ? "bg-success" : "bg-[#b9b5aa]")} aria-hidden />
              {status.data?.telegramConnected ? "Connected" : settings.telegramLinked ? "Linked, bot offline" : "Not linked. Send /start to your bot."}
            </div>
          </Row>
        </div>
      </Card>

      {/* Filters */}
      <Card>
        <CardHeader title="Filters" action={<span className="text-[12.5px] text-muted">Loops can override these</span>} />
        <div className="divide-y divide-border">
          <Row title="Match threshold" hint="Jobs scoring below this are dropped.">
            <Field label="Match threshold" error={errors.matchThreshold} className="w-28 [&>label]:sr-only">
              {(id) => <Input id={id} inputMode="numeric" value={form.matchThreshold} onChange={(e) => setF("matchThreshold", e.target.value)} aria-invalid={!!errors.matchThreshold} className="num text-right" />}
            </Field>
          </Row>
          <Row title="Notice period" hint="Drop jobs that want someone sooner than this (days).">
            <Field label="Notice days" error={errors.noticeDays} className="w-28 [&>label]:sr-only">
              {(id) => <Input id={id} inputMode="numeric" value={form.noticeDays} onChange={(e) => setF("noticeDays", e.target.value)} aria-invalid={!!errors.noticeDays} className="num text-right" />}
            </Field>
          </Row>
          <Row title="Maximum years required" hint="Flag jobs asking for more experience than this.">
            <Field label="Max years" error={errors.maxYearsRequired} className="w-28 [&>label]:sr-only">
              {(id) => <Input id={id} inputMode="numeric" value={form.maxYearsRequired} onChange={(e) => setF("maxYearsRequired", e.target.value)} aria-invalid={!!errors.maxYearsRequired} className="num text-right" />}
            </Field>
          </Row>
          <div className="px-5 py-4">
            <p className="text-[13.5px] font-medium">Salary floors</p>
            <p className="mb-3 mt-0.5 text-[12.5px] text-muted">Yearly minimum per currency. Leave blank for no floor. Jobs without a listed salary are kept and tagged.</p>
            <div className="grid grid-cols-4 gap-3">
              {Object.keys(form.floors).map((c) => (
                <Field key={c} label={c} error={errors[`floor-${c}`]}>
                  {(id) => <Input id={id} inputMode="numeric" value={form.floors[c]} onChange={(e) => setF("floors", { ...form.floors, [c]: e.target.value })} className="num" placeholder="None" />}
                </Field>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-3">
          {!dirty && <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted"><Check className="size-[13px]" strokeWidth={1.75} /> All changes saved</span>}
          {dirty && <Button onClick={() => { setForm(toForm(settings)); setErrors({}); }}>Discard</Button>}
          <Button variant="primary" disabled={!dirty || update.isPending} onClick={save}>{update.isPending ? "Saving..." : "Save changes"}</Button>
        </div>
      </Card>

      {/* Sources */}
      <Card>
        <CardHeader title="Sources" />
        <ul className="divide-y divide-border">
          {sources.isLoading && [0, 1, 2, 3].map((i) => <li key={i} className="px-5 py-4"><Skeleton className="h-5" /></li>)}
          {sources.data?.filter((s) => s.id !== "manual").map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-6 px-5 py-3.5">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[13.5px] font-medium">
                  {SOURCE_LABEL[s.id]}
                  <Badge tone={s.configured ? "success" : "warning"} dot>{s.configured ? "Configured" : "Not configured"}</Badge>
                </p>
                <p className="mt-0.5 text-[12.5px] text-muted">
                  {s.configured ? `Fetched at most every ${s.minIntervalMinutes >= 60 ? `${s.minIntervalMinutes / 60}h` : `${s.minIntervalMinutes}m`}.` : <>Add <span className="num rounded bg-[#f1f0ea] px-1">{s.needsKey}</span> to your .env to turn this on.</>}
                </p>
              </div>
              <Switch
                checked={s.enabled && s.configured}
                disabled={!s.configured}
                aria-label={`${SOURCE_LABEL[s.id]} source`}
                onCheckedChange={(on) => update.mutate({ sources: { [s.id]: on } })}
              />
            </li>
          ))}
        </ul>
      </Card>

      <ConfirmDialog
        open={confirmLive}
        onOpenChange={setConfirmLive}
        title="Turn off dry run?"
        danger
        confirmLabel="Turn off dry run"
        description={
          <>
            <p>Real applications will be submitted after you approve them on Telegram.</p>
            <p className="mt-2">Nothing is ever sent without your tap. Each submit still needs its own confirmation, and the daily cap of {settings.dailyCap} still applies.</p>
          </>
        }
        onConfirm={() => update.mutate({ dryRun: false }, { onSuccess: () => toast("Dry run is off") })}
      />
    </div>
  );
}

export default function SettingsPage() {
  useDocumentTitle("Settings");
  const { data, isLoading, isError, refetch } = useSettings();
  return (
    <>
      <PageHeader title="Settings" description="Safety switches, filters and sources." />
      <div className="max-w-[820px]">
        {isLoading && (
          <div className="space-y-6">{[0, 1].map((i) => <Card key={i} className="space-y-4 p-5"><Skeleton className="h-5 w-32" /><Skeleton className="h-10" /><Skeleton className="h-10" /></Card>)}</div>
        )}
        {isError && <Card><ErrorState onRetry={() => refetch()} /></Card>}
        {data && <SettingsForm settings={data} />}
      </div>
    </>
  );
}
