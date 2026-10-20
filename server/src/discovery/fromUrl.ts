import type { HttpGet, RawJob } from "../contracts.js";
import { mapAshbyJob, ashbyListUrl } from "./ashby.js";
import { arr, defaultHttpGet, getJson, rec } from "./util.js";
import { titleCaseSlug } from "./boards.js";
import { mapGreenhouseJob } from "./greenhouse.js";
import { mapLeverJob } from "./lever.js";

// For a pasted Greenhouse / Lever / Ashby job URL: fetch that one posting via the public API.
// Returns null for any other URL (the caller then asks me to paste the JD text).
export async function fetchJobFromUrl(url: string, http: HttpGet = defaultHttpGet): Promise<RawJob | null> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);

  // Greenhouse: boards.greenhouse.io/<token>/jobs/<id>, job-boards[.eu].greenhouse.io/<token>/jobs/<id>
  if (host.endsWith("greenhouse.io")) {
    const token = parts[0];
    const id = parts[1] === "jobs" ? parts[2] : u.searchParams.get("gh_jid");
    if (!token || !id || !/^\d+$/.test(id)) return null;
    const body = await getJson(http, `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs/${id}`);
    return body ? mapGreenhouseJob(body, titleCaseSlug(token)) : null;
  }

  // Lever: jobs.lever.co/<company>/<uuid> (EU boards live on jobs.eu.lever.co / api.eu.lever.co)
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
    const [company, id] = parts;
    if (!company || !id) return null;
    const api = host === "jobs.eu.lever.co" ? "api.eu.lever.co" : "api.lever.co";
    const body = await getJson(http, `https://${api}/v0/postings/${encodeURIComponent(company)}/${encodeURIComponent(id)}`);
    return body ? mapLeverJob(body, titleCaseSlug(company)) : null;
  }

  // Ashby has no single-posting endpoint: fetch the board and pick the id.
  if (host === "jobs.ashbyhq.com") {
    const [board, id] = parts;
    if (!board || !id) return null;
    const body = await getJson(http, ashbyListUrl(board));
    const raw = arr(rec(body).jobs).find((j) => rec(j).id === id);
    return raw ? mapAshbyJob(raw, titleCaseSlug(board)) : null;
  }

  return null;
}
