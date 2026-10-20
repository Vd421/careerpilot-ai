# Brief: backend

Read `docs/briefs/_common.md` first.

**You own:** `server/prisma/` (seed + future schema proposals), `server/src/{api,tailor,pdf,queue,filters}/`,
`server/tests/{api,tailor,pdf,queue,filters}/`.
**You call (owned by integrations, typed in contracts.ts):** `runDiscovery`, `sendJobCard`, `startApplication`,
`submitRawAnswer`, `approveAnswer`. Until they exist, import them through a small `deps` object so you can stub them.

## B1. Seed
`server/prisma/seed.ts` + `npm run db:seed` (ask lead to add the script). Upserts: Settings id=1 (defaults from schema);
ResumeVariant "A" → `data/private/resume.json`; if `data/private/resume.b.json` exists, variant "B". Idempotent.

## B2. Filters — `src/filters/`
Implements `ApplyFilters` from contracts. Pure functions, no DB, heavily unit-tested.
- **Salary:** normalize to yearly (hourly ×2080, monthly ×12, "LPA"/"lakh" ×100000). Compare max (or min if no max)
  against `salaryFloors[currency]`. Unknown salary or unknown currency → keep, tag `salary_unknown`.
- **Notice:** I have 60 days. Drop on "immediate joiner(s)", "join(ing) within N days/weeks" with N < 60 days,
  "notice period of max N days" with N < 60. Don't drop on "immediate start preferred but flexible" → tag `notice_risk`.
- **Seniority:** drop titles with senior/sr./staff/principal/lead/head/director/manager (except "engineering manager"
  isn't a target anyway, drop it too); description "N+ years" with N > `maxYearsRequired` → tag `seniority_risk`
  (don't drop; scoring flags it).
- **Loop filters:** `remoteOnly`, `excludeKeywords`, `minScore` (score threshold is applied after scoring, export
  `passesThreshold(score, settings, loop)`).
- `dedupeKey(company, title, url)`: lowercase, strip punctuation/whitespace runs, strip URL query + trailing slash.
Return human-readable `reasons` (shown in the dashboard).

## B3. Tailoring — `src/tailor/`
`tailorForJob(jobId, variantId?)` (contract `TailorForJob`).
- Loads the variant's resume file (`loadResume`), the job, the score's matched/missing skills.
- Sonnet 5.5 via `messages.parse` + Zod schema of `TailoredResume`. `max_tokens` 4000. Prompt rules: reword and reorder
  only; each bullet cites `sourceBulletId`; keep every number exactly; don't add tools/skills not in the source bullet;
  pick the 3–5 most relevant bullets per section; drop irrelevant sections; headline only from resume facts.
  Contact details are not sent (like scoring).
- `validate.ts` — the 4 rules in contracts.ts. Numbers: extract `\d+(\.\d+)?%?` tokens from rewrite; each must appear
  in the source bullet. Skills in `skillsOrder` must exist (case-insensitive) in `resume.skills`.
  On any violation: AiCall still logged, `resume.tailor_rejected` AgentAction with the violations, retry once with the
  violations appended to the prompt, then throw `TailorError`. Never save an invalid version.
- Saves `ResumeVersion`, writes `resume.tailored` action. Respects `maxTailorsPerDay` (count today's tailor AiCalls).
- Tests: fake model returning (a) valid output, (b) invented bullet id, (c) changed number "40%"→"60%", (d) unknown
  skill, (e) bad then good (retry path). Assert nothing invalid is ever saved.

## B4. PDF — `src/pdf/`
`renderResumePdf(resumeVersionId)`. Build the resume from the **source** resume (contact, education) + tailored
sections/bullets. One clean, ATS-friendly single-column HTML template (system serif/sans, no images, no tables for
layout, real text). Playwright `chromium.launch()` → `page.setContent` → `page.pdf({ format: "A4" })` →
`data/private/pdfs/<resumeVersionId>.pdf`; set `pdfPath`; `resume.pdf_rendered` action. Export the pure
`renderResumeHtml()` separately and unit-test it (escapes HTML, includes every tailored bullet, no bullet text that
isn't in the tailored version). One real PDF test (skippable via `SKIP_BROWSER_TESTS=1`).

## B5. Queue — `src/queue/`
pg-boss (v12 installed; read its README in node_modules for the current API, don't guess). Same `DATABASE_URL`.
- `startQueue()` / `stopQueue()`, `enqueue` (contract `Enqueue`). Workers for every name in `QUEUES`.
- **Loop scheduler:** on start and whenever a loop changes, schedule each active loop's cron → `loop.run`;
  paused loops unscheduled. Export `syncLoopSchedules()` for the API.
- **Pipeline (`loop.run`):** `runDiscovery(query, enabled sources ∩ loop.sources)` → dedupe (skip existing dedupeKey,
  `job.deduped`) → insert Job (`loopId`, `job.discovered`) → filters (drop → stage `filtered_out` + reasons) →
  enqueue `job.score` (respect `maxScoresPerDay`; over cap → leave `discovered`, log once) → after scoring, threshold
  → stage `scored`; passes → `job.push`.
- **`job.push`:** create Application (`pending_approval`, `idempotencyKey: apply:<jobId>`, `loopId`,
  `resumeVariantId` via A/B rotation: pick the loop variant with the fewest applications), stage `pushed`,
  then `sendJobCard`. Unique key means a retry never double-creates.
- Workers for `resume.tailor`, `apply.prescan`, `apply.fill` just call the owners' functions.
- Tests: pipeline with fake discovery/score/telegram (dedupe, filtered_out, cap, A/B rotation, idempotent push).

## B6. REST API — `src/api/`
Every route listed in contracts.ts, as an Express `Router` exported from `src/api/index.ts` (lead mounts it at `/api`
in `app.ts`). Validate bodies/queries with Zod → 400 `ApiError`. Map DB rows to the contract DTOs in one `mappers.ts`.
- `POST /api/jobs`: URL of a Greenhouse/Lever/Ashby job → ask integrations' `fetchJobFromUrl` (message lead for the
  signature if missing) else require `description`. Dedupe; then enqueue score.
- `POST /jobs/:id/push` enqueues `job.push` — the dashboard can send a card, **but cannot approve or submit**. There is
  no API route that sets `approvedAt` or `submitApprovedAt` (those come only from Telegram taps).
- `PUT /api/settings`: clamp `dailyCap` to `HARD_DAILY_CAP`; log `settings.updated` with the diff; flipping `dryRun`
  to false is logged loudly.
- Serve `GET /api/resume-versions/:id/pdf` and `GET /api/screenshots/:file` (path-traversal safe: basename only,
  must exist in `data/private/screenshots/`).
- Loop stats: found = jobs with loopId; approved = applications with approvedAt; applied = status in
  applied/replied/interview/rejected/offer; replied = replied/interview/offer; responseRate = replied/applied (0 if none).
  Per-variant stats the same, grouped by `resumeVariantId`. `nextRunAt` from the cron.
- supertest tests for every route (happy path + one 400/404 each).

Order: B1 → B2 → B3 → B4 → B6 (stubs for queue) → B5. Report after each.
