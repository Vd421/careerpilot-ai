import { isAbsolute, resolve } from "node:path";

// Repo root = three levels up from server/src/tailor. Paths in the DB are stored relative to it
// so the project can move between machines (and into Docker) without rewriting rows.
export const REPO_ROOT = resolve(import.meta.dirname, "../../..");
export const PRIVATE_DIR = resolve(REPO_ROOT, "data/private");

export function resolveRepoPath(p: string): string {
  return isAbsolute(p) ? p : resolve(REPO_ROOT, p);
}
