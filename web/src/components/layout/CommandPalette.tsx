import { Command } from "cmdk";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Activity, Briefcase, CircleHelp, ClipboardPaste, CornerDownLeft, LayoutDashboard, Repeat2, Search, Send, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useJobs } from "@/lib/queries";
import { useUi } from "@/lib/ui-context";
import { STATUS_LABEL } from "@/lib/format";

const PAGES = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/loops", label: "Loops", icon: Repeat2 },
  { to: "/jobs", label: "Jobs", icon: Briefcase },
  { to: "/applications", label: "Applications", icon: Send },
  { to: "/questions", label: "Questions", icon: CircleHelp },
  { to: "/activity", label: "Activity", icon: Activity },
  { to: "/settings", label: "Settings", icon: Settings },
];

const itemCls =
  "flex h-9 cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 text-[13.5px] text-[#3a3834] aria-selected:bg-accent-tint aria-selected:text-text";

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, setNewJobOpen } = useUi();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const jobs = useJobs({ pageSize: 100 });

  // Global shortcut: Cmd/Ctrl+K toggles.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, setPaletteOpen]);

  useEffect(() => {
    if (!paletteOpen) setQuery("");
  }, [paletteOpen]);

  const go = (fn: () => void) => {
    setPaletteOpen(false);
    fn();
  };

  return (
    <DialogPrimitive.Root open={paletteOpen} onOpenChange={setPaletteOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="anim-fade fixed inset-0 z-50 flex items-start justify-center bg-[#1f1e1b]/30 px-6 pt-[14vh]">
          <DialogPrimitive.Content className="anim-pop w-full max-w-[580px] overflow-hidden rounded-[12px] border border-border bg-surface shadow-pop">
            <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Search jobs, jump to a page, or paste a job description.</DialogPrimitive.Description>
            <Command label="Command palette" loop>
              <div className="flex items-center gap-2.5 border-b border-border px-4">
                <Search className="size-4 shrink-0 text-muted" strokeWidth={1.5} />
                <Command.Input
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Search jobs, jump to a page..."
                  className="h-12 w-full bg-transparent text-[14.5px] outline-none placeholder:text-[#9b988f]"
                />
              </div>
              <Command.List className="max-h-[360px] overflow-y-auto p-2">
                <Command.Empty className="px-3 py-8 text-center text-[13px] text-muted">No matches. Try a company or role name.</Command.Empty>

                <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.04em] [&_[cmdk-group-heading]]:text-muted">
                  <Command.Item value="paste jd add job new" className={itemCls} onSelect={() => go(() => setNewJobOpen(true))}>
                    <ClipboardPaste className="size-4 text-muted" strokeWidth={1.5} />
                    Paste a job description
                  </Command.Item>
                </Command.Group>

                <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.04em] [&_[cmdk-group-heading]]:text-muted">
                  {PAGES.map(({ to, label, icon: Icon }) => (
                    <Command.Item key={to} value={`go ${label}`} className={itemCls} onSelect={() => go(() => navigate(to))}>
                      <Icon className="size-4 text-muted" strokeWidth={1.5} />
                      {label}
                    </Command.Item>
                  ))}
                </Command.Group>

                {jobs.data && jobs.data.items.length > 0 && (
                  <Command.Group heading="Jobs" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.04em] [&_[cmdk-group-heading]]:text-muted">
                    {jobs.data.items.map((j) => (
                      <Command.Item key={j.id} value={`job ${j.company} ${j.title} ${j.id}`} className={itemCls} onSelect={() => go(() => navigate(`/jobs?job=${j.id}`))}>
                        <Briefcase className="size-4 shrink-0 text-muted" strokeWidth={1.5} />
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-medium">{j.company}</span>
                          <span className="text-muted"> {"·"} {j.title}</span>
                        </span>
                        <span className="text-[11.5px] text-muted">{STATUS_LABEL[j.status]}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
              </Command.List>
              <div className="flex items-center justify-between border-t border-border bg-[#fbfaf8] px-4 py-2 text-[11.5px] text-muted">
                <span>Navigate with the arrow keys</span>
                <span className="inline-flex items-center gap-1">
                  <CornerDownLeft className="size-3" strokeWidth={1.5} /> to select
                </span>
              </div>
            </Command>
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
