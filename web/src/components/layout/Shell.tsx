import { motion } from "motion/react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { CommandPalette } from "./CommandPalette";
import { NewJobDialog } from "./NewJobDialog";
import { UiProvider } from "@/lib/ui-context";
import { ToastProvider } from "@/lib/toast";

export function Shell() {
  const { pathname } = useLocation();
  // Key on the first path segment so /loops -> /loops/3 doesn't replay the whole transition.
  const key = pathname.split("/")[1] || "overview";
  return (
    <ToastProvider>
      <UiProvider>
        <a href="#main" className="sr-only z-[80] rounded-md bg-surface px-3 py-2 text-[13px] focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:shadow-pop">
          Skip to content
        </a>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <main id="main" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto outline-none [scrollbar-gutter:stable]">
            <motion.div
              key={key}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="mx-auto w-full max-w-[1200px] px-8 pb-16 pt-8"
            >
              <Outlet />
            </motion.div>
          </main>
        </div>
        <CommandPalette />
        <NewJobDialog />
      </UiProvider>
    </ToastProvider>
  );
}
