// Title words that mean "not a junior-friendly role". Letters can't follow, so "leadership" doesn't match "lead".
const SENIOR_TITLE = /(^|[^a-z])(senior|sr\.?|staff|principal|lead|head|director|manager)(?![a-z])/i;

export function seniorTitleWord(title: string): string | null {
  const m = title.match(SENIOR_TITLE);
  return m ? m[2].toLowerCase() : null;
}

// Largest "N+ years" / "at least N years" / "N-M years" (uses the lower bound) in the text, or null.
export function maxYearsRequired(description: string): number | null {
  const t = description.toLowerCase();
  let max: number | null = null;
  const res = [
    /(\d+)\s*\+\s*(?:years?|yrs?)/g,
    /(?:at\s+least|minimum(?:\s+of)?|min\.?)\s*(\d+)\s*(?:years?|yrs?)/g,
    /(\d+)\s*(?:-|–|to)\s*\d+\s*(?:years?|yrs?)/g,
  ];
  for (const re of res) {
    for (const m of t.matchAll(re)) {
      const n = Number(m[1]);
      if (max === null || n > max) max = n;
    }
  }
  return max;
}
