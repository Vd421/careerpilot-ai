import { X } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

/** Type a value, press Enter or comma to add. Backspace on an empty box removes the last one. */
export function TagInput({ id, value, onChange, placeholder, label, invalid }: { id?: string; value: string[]; onChange: (v: string[]) => void; placeholder?: string; label: string; invalid?: boolean }) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const parts = draft.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange([...value, ...parts.filter((p) => !value.some((v) => v.toLowerCase() === p.toLowerCase()))]);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div
      className={cn(
        "flex min-h-8 flex-wrap items-center gap-1.5 rounded-[8px] border border-border bg-surface px-2 py-1 transition-colors focus-within:border-accent focus-within:outline-2 focus-within:outline-accent/30 hover:border-[#d5d2c9]",
        invalid && "border-danger",
      )}
    >
      {value.map((v) => (
        <span key={v} className="inline-flex h-6 items-center gap-1 rounded-md bg-[#f1f0ea] pl-2 pr-1 text-[12.5px]">
          {v}
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))} className="flex size-4 items-center justify-center rounded text-muted hover:bg-black/5 hover:text-text">
            <X className="size-3" strokeWidth={1.75} />
          </button>
        </span>
      ))}
      <input
        id={id}
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={commit}
        placeholder={value.length ? "" : placeholder}
        className="h-6 min-w-24 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[#9b988f]"
      />
    </div>
  );
}
