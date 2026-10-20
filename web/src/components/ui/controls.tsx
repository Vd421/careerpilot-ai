import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Copy } from "lucide-react";
import { useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export function Switch({ className, ...p }: ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full border border-transparent bg-[#d6d3ca] transition-colors duration-150 data-[state=checked]:bg-accent disabled:opacity-50",
        className,
      )}
      {...p}
    >
      <SwitchPrimitive.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.2)] transition-transform duration-150 data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  );
}

export function Checkbox({ className, ...p }: ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn("flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-[#c9c6bc] bg-surface transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent", className)}
      {...p}
    >
      <CheckboxPrimitive.Indicator>
        <Check className="size-3 text-white" strokeWidth={2.5} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...p }: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("inline-flex items-center gap-1 border-b border-border", className)} {...p} />;
}
export function TabsTrigger({ className, ...p }: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "relative -mb-px h-9 px-3 text-[13px] font-medium text-muted transition-colors hover:text-text data-[state=active]:text-text",
        "after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent after:opacity-0 after:transition-opacity data-[state=active]:after:opacity-100",
        className,
      )}
      {...p}
    />
  );
}
export const TabsContent = TabsPrimitive.Content;

/** Segmented control for view toggles (board / table). */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; aria?: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[8px] border border-border bg-[#f1f0ea] p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          aria-label={o.aria}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-[12.5px] font-medium transition-colors",
            value === o.value ? "bg-surface text-text shadow-card" : "text-muted hover:text-text",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;
export function Tip({ label, children, side = "right", disabled }: { label: string; children: ReactNode; side?: "top" | "right" | "bottom" | "left"; disabled?: boolean }) {
  if (disabled) return <>{children}</>;
  return (
    <TooltipPrimitive.Root delayDuration={250}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side={side} sideOffset={8} className="z-[60] rounded-md bg-text px-2 py-1 text-[12px] text-white shadow-pop">
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export function MatchBar({ value, className }: { value: number | null; className?: string }) {
  if (value == null) return <span className="num text-[12.5px] text-muted">-</span>;
  const tone = value >= 80 ? "bg-accent" : value >= 65 ? "bg-[#7ea9a5]" : "bg-[#c4c1b8]";
  return (
    <div className={cn("flex items-center gap-2", className)} title={`${value}% match`}>
      <span className="num w-7 text-right text-[12.5px]">{value}%</span>
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-[#eceae3]" role="img" aria-label={`${value} percent match`}>
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={done ? "Copied" : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          /* clipboard can be blocked; the visual confirmation is still harmless */
        }
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
    >
      {done ? <Check className="text-success" strokeWidth={1.5} /> : <Copy strokeWidth={1.5} />}
      {done ? "Copied" : label}
    </Button>
  );
}
