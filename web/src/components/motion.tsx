import { animate, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Counts from 0 to `value` once, on first mount. Reduced motion shows the final number. */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  const done = useRef(false);

  useEffect(() => {
    if (reduce) {
      setShown(value);
      return;
    }
    if (done.current) {
      setShown(value);
      return;
    }
    done.current = true;
    const controls = animate(0, value, { duration: 0.7, ease: "easeOut", onUpdate: (v) => setShown(Math.round(v)) });
    return () => controls.stop();
  }, [value, reduce]);

  return <span className={className}>{shown}</span>;
}

/** List rows fade + rise 4px, staggered 20ms apart (capped so long lists don't crawl). */
export function Reveal({ index = 0, children, className, as = "div" }: { index?: number; children: ReactNode; className?: string; as?: "div" | "li" | "tr" }) {
  const Tag = motion[as];
  return (
    <Tag
      className={className}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut", delay: Math.min(index, 14) * 0.02 }}
    >
      {children}
    </Tag>
  );
}
