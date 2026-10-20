import type { HTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-[10px] border border-border bg-surface shadow-card", className)} {...p} />;
}

export function CardHeader({ title, action, className }: { title: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex h-12 items-center justify-between gap-3 border-b border-border px-5", className)}>
      <h2 className="text-[13.5px]">{title}</h2>
      {action}
    </div>
  );
}

export function Skeleton({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("skeleton h-4 w-full", className)} {...p} />;
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex min-h-9 items-start justify-between gap-4">
      <div>
        <h1 className="text-[22px] leading-8">{title}</h1>
        {description && <p className="mt-0.5 text-[13.5px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({ icon: Icon, title, hint, action, className }: { icon?: LucideIcon; title: string; hint?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      {Icon && (
        <div className="mb-3 flex size-9 items-center justify-center rounded-full bg-accent-tint text-accent">
          <Icon className="size-4" strokeWidth={1.5} />
        </div>
      )}
      <p className="text-[13.5px] font-medium">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-[13px] text-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <EmptyState
      title="Something went wrong"
      hint={message ?? "The request failed. Try again in a moment."}
      action={
        onRetry && (
          <button onClick={onRetry} className="h-8 rounded-[8px] border border-border bg-surface px-3 text-[13px] font-medium hover:bg-[#fbfaf8]">
            Retry
          </button>
        )
      }
    />
  );
}
