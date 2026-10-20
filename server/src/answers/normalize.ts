// Same question, many spellings: "Notice period? *", "notice period (required)" -> "notice period".
export function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/\(\s*required\s*\)/g, " ")
    .replace(/[*✱]/g, " ")
    .replace(/[^a-z0-9+#\s]/g, " ") // punctuation (keep c++ / c#)
    .replace(/\s+/g, " ")
    .trim();
}

// Whole-word containment, so the pattern "city" matches "current city" but not "capacity".
export function containsPhrase(normalizedText: string, normalizedPattern: string): boolean {
  if (!normalizedPattern) return false;
  return ` ${normalizedText} `.includes(` ${normalizedPattern} `);
}

// For select/radio fields the answer must BE one of the options (case-insensitive; prefix either way).
export function mapToOption(value: string, options: string[]): string | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  const exact = options.find((o) => o.trim().toLowerCase() === v);
  if (exact) return exact;
  const prefix = options.find((o) => {
    const opt = o.trim().toLowerCase();
    return opt.length > 0 && (opt.startsWith(v) || v.startsWith(opt));
  });
  return prefix ?? null;
}
