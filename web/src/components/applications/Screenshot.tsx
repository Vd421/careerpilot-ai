import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ImageOff, X } from "lucide-react";
import { useState } from "react";
import { screenshotSrc } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** Small clickable preview; opens a lightbox with the full image. */
export function ScreenshotThumb({ url, label, className }: { url: string | null; label: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState(false);
  if (!url) {
    return <span className="text-[12px] text-muted">-</span>;
  }
  const src = screenshotSrc(url);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <button
          aria-label={`Open screenshot for ${label}`}
          onClick={(e) => e.stopPropagation()}
          className={cn("block h-9 w-12 shrink-0 overflow-hidden rounded-[6px] border border-border bg-[#f3f2ee] transition-colors hover:border-[#c9c6bc]", className)}
        >
          {broken ? <ImageOff className="m-auto size-[14px] text-muted" strokeWidth={1.5} /> : <img src={src} alt="" onError={() => setBroken(true)} className="size-full object-cover object-top" />}
        </button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="anim-fade fixed inset-0 z-[60] flex items-center justify-center bg-[#1f1e1b]/55 p-8">
          <DialogPrimitive.Content className="anim-pop relative max-h-full max-w-[920px] overflow-auto rounded-[12px] border border-border bg-surface p-2 shadow-pop">
            <DialogPrimitive.Title className="sr-only">Screenshot for {label}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Screenshot taken when the form was filled.</DialogPrimitive.Description>
            <DialogPrimitive.Close asChild>
              <Button variant="secondary" size="iconSm" aria-label="Close screenshot" className="absolute right-4 top-4">
                <X strokeWidth={1.5} />
              </Button>
            </DialogPrimitive.Close>
            {broken ? (
              <div className="flex h-64 w-[520px] items-center justify-center text-[13px] text-muted">Screenshot file is not available.</div>
            ) : (
              <img src={src} alt={`Filled application form for ${label}`} className="block max-h-[80vh] w-full rounded-[8px]" />
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
