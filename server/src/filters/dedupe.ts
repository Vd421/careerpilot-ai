function words(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// Same job posted twice (different tracking params, trailing slash, casing) gets the same key.
export function dedupeKey(company: string, title: string, url: string | null | undefined): string {
  const cleanUrl = (url ?? "")
    .split(/[?#]/)[0]
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  return `${words(company)}|${words(title)}|${cleanUrl}`;
}
