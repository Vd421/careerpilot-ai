import { Activity, Briefcase, CircleHelp, LayoutDashboard, PanelLeftClose, PanelLeftOpen, Plus, Repeat2, Search, Send, Settings } from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useLocalStorage } from "@/lib/hooks";
import { useRecentJobs, useStatus } from "@/lib/queries";
import { useUi } from "@/lib/ui-context";
import { Skeleton } from "@/components/ui/card";
import { Tip } from "@/components/ui/controls";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/loops", label: "Loops", icon: Repeat2 },
  { to: "/jobs", label: "Jobs", icon: Briefcase },
  { to: "/applications", label: "Applications", icon: Send },
  { to: "/questions", label: "Questions", icon: CircleHelp },
  { to: "/activity", label: "Activity", icon: Activity },
  { to: "/settings", label: "Settings", icon: Settings },
];

export const SIDEBAR_KEY = "careerpilot.sidebar.collapsed";

function Logo() {
  return (
    <div className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-accent" aria-hidden>
      <svg viewBox="0 0 32 32" className="size-[18px]">
        <path d="M9 21l14-10-5 12-2.5-4.5z" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/** Label text fades with the width transition instead of reflowing. */
function Label({ collapsed, children, className }: { collapsed: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cn("truncate whitespace-nowrap transition-opacity duration-150", collapsed ? "opacity-0" : "opacity-100 delay-75", className)}>
      {children}
    </span>
  );
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useLocalStorage<boolean>(SIDEBAR_KEY, false);
  const { setNewJobOpen, setPaletteOpen } = useUi();
  const { data: status } = useStatus();
  const recent = useRecentJobs();
  const navigate = useNavigate();
  const loc = useLocation();
  const activeJob = new URLSearchParams(loc.search).get("job");

  const used = status?.appliedToday ?? 0;
  const cap = status?.dailyCap ?? 15;

  const itemBase = "group flex h-8 items-center gap-2.5 rounded-[8px] px-[8px] text-[13.5px] transition-colors duration-150";

  return (
    <aside
      data-testid="sidebar"
      data-collapsed={collapsed}
      aria-label="Sidebar"
      className={cn(
        "relative z-20 flex h-screen shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar transition-[width] duration-200 ease-out",
        collapsed ? "w-[56px]" : "w-[260px]",
      )}
    >
      {/* Header */}
      <div className={cn("flex shrink-0 px-[12px] pt-3", collapsed ? "flex-col items-center gap-2" : "h-12 items-center justify-between")}>
        <div className="flex items-center gap-2.5 pl-1">
          <Logo />
          {!collapsed && <span className="text-[15px] font-semibold tracking-[-0.015em]">CareerPilot</span>}
        </div>
        <Tip label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          <button
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            className="flex size-7 items-center justify-center rounded-[8px] text-muted transition-colors hover:bg-hover hover:text-text"
          >
            {collapsed ? <PanelLeftOpen className="size-[16px]" strokeWidth={1.5} /> : <PanelLeftClose className="size-[16px]" strokeWidth={1.5} />}
          </button>
        </Tip>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-[12px] pb-2 pt-3">
        {/* Primary action + search */}
        <Tip disabled={!collapsed} label="New job">
          <button
            onClick={() => setNewJobOpen(true)}
            aria-label="New job"
            className="flex h-9 items-center gap-2.5 rounded-[8px] bg-accent px-[8px] text-[13.5px] font-medium text-white transition-colors hover:bg-accent-hover"
          >
            <Plus className="size-[16px] shrink-0" strokeWidth={1.75} />
            <Label collapsed={collapsed}>New job</Label>
          </button>
        </Tip>
        <Tip disabled={!collapsed} label="Search (Ctrl K)">
          <button
            onClick={() => setPaletteOpen(true)}
            aria-label="Open command palette"
            className={cn(itemBase, "mt-1.5 w-full text-muted hover:bg-hover hover:text-text")}
          >
            <Search className="size-[16px] shrink-0" strokeWidth={1.5} />
            <Label collapsed={collapsed} className="flex-1 text-left">
              Search
            </Label>
            {!collapsed && <kbd className="num rounded border border-border bg-surface px-1.5 py-px text-[10.5px] text-muted">Ctrl K</kbd>}
          </button>
        </Tip>

        {/* Nav */}
        <nav aria-label="Main" className="mt-3 space-y-0.5">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <Tip disabled={!collapsed} key={to} label={label}>
              <NavLink
                to={to}
                end={end}
                aria-label={label}
                className={({ isActive }) => cn(itemBase, isActive ? "bg-[#e9e7e0] font-medium text-text" : "text-[#55524b] hover:bg-hover hover:text-text")}
              >
                <Icon className="size-[16px] shrink-0" strokeWidth={1.5} />
                <Label collapsed={collapsed}>{label}</Label>
              </NavLink>
            </Tip>
          ))}
        </nav>

        {/* Recent */}
        <div className={cn("mt-5 flex min-h-0 flex-1 flex-col transition-opacity duration-150", collapsed && "pointer-events-none opacity-0")} aria-hidden={collapsed}>
          <h2 className="px-[8px] pb-1.5 text-[11.5px] font-medium uppercase tracking-[0.04em] text-muted">Recent</h2>
          <ul className="-mx-1 min-h-0 flex-1 space-y-px overflow-y-auto px-1">
            {recent.isLoading &&
              Array.from({ length: 6 }).map((_, i) => (
                <li key={i} className="px-[8px] py-1.5">
                  <Skeleton className="h-3.5" style={{ width: `${70 + ((i * 13) % 25)}%` }} />
                </li>
              ))}
            {recent.data?.map((j) => (
              <li key={j.id}>
                <button
                  tabIndex={collapsed ? -1 : 0}
                  onClick={() => navigate(`/jobs?job=${j.id}`)}
                  title={`${j.company} · ${j.title}`}
                  className={cn(
                    "block h-7 w-full truncate rounded-[6px] px-[8px] text-left text-[13px] transition-colors hover:bg-hover",
                    activeJob === String(j.id) ? "bg-[#e9e7e0] text-text" : "text-[#55524b] hover:text-text",
                  )}
                >
                  <span className="font-medium text-text">{j.company}</span>
                  <span className="text-muted"> {"·"} {j.title}</span>
                </button>
              </li>
            ))}
            {recent.data?.length === 0 && <li className="px-[8px] py-1 text-[12.5px] text-muted">Jobs you add or find will show up here.</li>}
          </ul>
        </div>
        {collapsed && <div className="flex-1" />}
      </div>

      {/* Footer */}
      <div className="shrink-0 space-y-1 border-t border-border px-[12px] py-3">
        <Tip disabled={!collapsed} label={status?.telegramConnected ? "Telegram connected" : "Telegram not connected"}>
          <div className={cn(itemBase, "cursor-default text-[12.5px] text-muted")}>
            <span className="flex size-[16px] shrink-0 items-center justify-center">
              <span
                aria-hidden
                className={cn("size-2 rounded-full", status?.telegramConnected ? "bg-success shadow-[0_0_0_3px_rgba(63,125,78,.15)]" : "bg-[#b9b5aa]")}
              />
            </span>
            <Label collapsed={collapsed}>{status?.telegramConnected ? "Telegram connected" : "Telegram offline"}</Label>
          </div>
        </Tip>
        <Tip disabled={!collapsed} label={`${used} of ${cap} applications today`}>
          <div className={cn(itemBase, "cursor-default text-[12.5px] text-muted")} aria-label={`${used} of ${cap} applications today`}>
            <span className="num flex size-[16px] shrink-0 items-center justify-center text-[10.5px] font-medium text-text">{collapsed ? used : ""}</span>
            <span className={cn("flex min-w-0 flex-1 items-center gap-2 transition-opacity duration-150", collapsed ? "opacity-0" : "opacity-100 delay-75")}>
              <span className="whitespace-nowrap">Applied today</span>
              <span className="num ml-auto text-text">
                {used}/{cap}
              </span>
            </span>
          </div>
        </Tip>
        <div className="!mt-2 flex items-center gap-2.5 rounded-[8px] px-[8px] py-1">
          <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-tint text-[11px] font-semibold text-accent" aria-hidden>
            V
          </div>
          <div className={cn("min-w-0 flex-1 leading-tight transition-opacity duration-150", collapsed ? "opacity-0" : "opacity-100 delay-75")}>
            <div className="truncate text-[13px] font-medium">Vaibhav Dhir</div>
            <div className="truncate text-[11.5px] text-muted">{status?.dryRun === false ? "Live mode" : "Dry run on"}</div>
          </div>
          {!collapsed && (
            <NavLink to="/settings" aria-label="Open settings" className="flex size-7 items-center justify-center rounded-[8px] text-muted hover:bg-hover hover:text-text">
              <Settings className="size-[16px]" strokeWidth={1.5} />
            </NavLink>
          )}
        </div>
      </div>
    </aside>
  );
}
