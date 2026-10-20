# Common rules for every teammate (read first)

You are a teammate on CareerPilot AI, a personal job-hunting agent with a human in the loop.
The lead (Opus) planned this sprint. Read, in order:
1. `CLAUDE.md` — product + **Hard rules** (they are absolute; the "I write the code" rule is paused, you write it)
2. `docs/SPRINT.md` — the flow, safety rules, your tasks
3. `server/src/contracts.ts` — shared types; code against these exactly
4. `server/prisma/schema.prisma` — the DB
5. Existing code for style: `server/src/scoring/scoreJob.ts`, `server/tests/scoring.test.ts`

## Hard rules (never break, even in tests or "temporary" code)
- Never submit an application or send an email without a recorded human tap (`approvedAt` + `submitApprovedAt`).
- No LinkedIn or Naukri automation of any kind: no scraping, no login, no form filling. Indeed is discovery-only via JSearch.
- Never invent experience, skills, numbers or form answers. Answers come only from me or approved answer-bank rows.
- Max 15 applications per day. Respect each API's rate limits and ToS.
- Every agent step writes an `AgentAction` row.
- Secrets only from `process.env`. Never hard-code keys. Personal data lives in `data/private/` (gitignored).

## How we work
- Only edit files in **your** folders (listed in your brief). Need something elsewhere (contracts, `app.ts`, `package.json`,
  another teammate's module)? Message the lead with SendMessage (`to: "main"`, that is the lead) — exact change + why. Don't wait idle:
  keep working on what you can, stub against the contract.
- Don't run `git commit`, `git add`, `npm install` in `server/`. Ask the lead for any new package.
- Don't run `prisma migrate`. Schema changes → message the lead (backend may propose them).
- Match the existing style: ESM, `.js` import suffixes, small files, short "why" comments, Zod at boundaries,
  model/IO calls injected so tests use fakes (see `ScoringModel` in scoreJob.ts).
- Tests: Vitest in `server/tests/<your-module>/`. Fakes for Claude, Telegram, Playwright and HTTP — **no network and no
  API cost in tests**. DB tests call `resetDb()` from `tests/helpers/resetDb.ts` in `beforeEach`. Run `npm test` from
  `server/` (Docker Postgres is up). Every task ships with tests.
- Claude calls: `getClaude()` and `MODELS` from `src/ai/client.ts`; `messages.parse` + `zodOutputFormat` like
  scoreJob; cap `max_tokens`; log an `AiCall` row **before** validating output. `MODELS.better` = `claude-sonnet-5-5`
  (thinking can't be "disabled" on it; leave `thinking` unset).
- Missing keys (Telegram, Adzuna, RapidAPI) are expected. Code must start without them and log a clear "X not configured,
  skipping" instead of crashing.

## Reporting
After each task: message the lead with: task id, files changed, how to verify, test count, anything you're unsure about.
The lead reviews, runs tests and commits. When all your tasks are done, send a final summary that includes
"interview notes": for each module, 3–4 lines on what it does, the key design choice, and one tricky edge case.
