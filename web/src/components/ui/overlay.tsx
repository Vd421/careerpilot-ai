import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const backdrop = "anim-fade fixed inset-0 z-50 bg-[#1f1e1b]/30";

export function DialogContent({
  title,
  description,
  children,
  className,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={cn(backdrop, "flex items-center justify-center p-6")}>
        <DialogPrimitive.Content
          className={cn("anim-pop flex max-h-[88vh] w-full max-w-[520px] flex-col rounded-[12px] border border-border bg-surface shadow-pop", className)}
        >
          <div className="flex items-start justify-between gap-4 px-6 pt-5">
            <div>
              <DialogPrimitive.Title className="text-[16px] font-semibold tracking-[-0.01em]">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-1 text-[13px] text-muted">{description}</DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="iconSm" aria-label="Close" className="-mr-2 -mt-1">
                <X strokeWidth={1.5} />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-3.5">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Overlay>
    </DialogPrimitive.Portal>
  );
}

/** Right-hand drawer: backdrop fades, panel slides in. */
export function Drawer({ open, onOpenChange, title, subtitle, children, width = 560 }: { open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; width?: number }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={cn(backdrop, "flex justify-end")}>
          <DialogPrimitive.Content
            style={{ width }}
            className="anim-drawer flex h-full max-w-[94vw] flex-col border-l border-border bg-surface shadow-pop"
          >
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
              <div className="min-w-0">
                <DialogPrimitive.Title className="truncate text-[16px] font-semibold tracking-[-0.01em]">{title}</DialogPrimitive.Title>
                <DialogPrimitive.Description asChild>
                  <div className="mt-0.5 text-[13px] text-muted">{subtitle}</div>
                </DialogPrimitive.Description>
              </div>
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="iconSm" aria-label="Close drawer" className="-mr-2">
                  <X strokeWidth={1.5} />
                </Button>
              </DialogPrimitive.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  danger,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  danger?: boolean;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={cn(backdrop, "flex items-center justify-center p-6")}>
          <AlertDialog.Content className="anim-pop w-full max-w-[460px] rounded-[12px] border border-border bg-surface p-6 shadow-pop">
            <AlertDialog.Title className="text-[16px] font-semibold tracking-[-0.01em]">{title}</AlertDialog.Title>
            <AlertDialog.Description asChild>
              <div className="mt-2 text-[13.5px] leading-relaxed text-muted">{description}</div>
            </AlertDialog.Description>
            <div className="mt-6 flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button>Cancel</Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <Button variant={danger ? "dangerSolid" : "primary"} onClick={onConfirm}>
                  {confirmLabel}
                </Button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Overlay>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
