// Board APIs return every job a company has, so we filter by title ourselves.
// Simple synonym groups so "SDE" finds "Software Engineer" and "full stack" finds "Fullstack".
const SYNONYM_GROUPS: string[][] = [
  ["sde", "swe", "software engineer", "software developer", "software development engineer"],
  ["full stack", "fullstack"],
  ["back end", "backend"],
  ["front end", "frontend"],
  ["ai engineer", "ml engineer", "machine learning engineer"],
];

const normalize = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9+#]+/g, " ").trim()} `;

function variants(keyword: string): string[] {
  const k = normalize(keyword);
  const out = new Set([k]);
  for (const group of SYNONYM_GROUPS) {
    if (group.some((g) => normalize(g) === k)) group.forEach((g) => out.add(normalize(g)));
  }
  return [...out];
}

// No keywords = no filter. Whole-word match, so "sde" doesn't match "inside".
export function titleMatches(title: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const t = normalize(title);
  return keywords.some((kw) => variants(kw).some((v) => t.includes(v)));
}
