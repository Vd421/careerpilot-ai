import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

interface Toast {
  id: number;
  text: string;
  tone: "ok" | "error";
}
const Ctx = createContext<{ toast: (text: string, tone?: Toast["tone"]) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const next = useRef(1);
  const toast = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = next.current++;
    setItems((p) => [...p.slice(-2), { id, text, tone }]);
    setTimeout(() => setItems((p) => p.filter((t) => t.id !== id)), 3800);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed bottom-5 right-5 z-[70] flex flex-col items-end gap-2">
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="pointer-events-auto flex items-center gap-2 rounded-[10px] border border-border bg-surface px-3.5 py-2.5 text-[13px] shadow-pop"
            >
              {t.tone === "ok" ? <CheckCircle2 className="size-4 text-success" strokeWidth={1.5} /> : <CircleAlert className="size-4 text-danger" strokeWidth={1.5} />}
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast must be used inside ToastProvider");
  return c.toast;
}
