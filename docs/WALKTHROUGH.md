# CareerPilot walkthrough

Plain-English tour of every module: what it does, why it's built that way, where to look, and one question an
interviewer is likely to ask (with an answer you can give).

**The 30-second pitch:** "It's a job-hunting agent I control from Telegram. It pulls jobs from official job-board APIs,
filters and scores them against my resume with Claude, tailors my resume per job without inventing anything (enforced
in code), fills the application form with Playwright, and only submits after I tap twice. Everything it does is logged
and visible on a React dashboard."

---

## 1. The big picture

**What:** Two Node processes and a database.
- **API** (`server/src/index.ts`) serves the dashboard's REST API.
- **Worker** (`server/src/worker.ts`) runs background jobs (pg-boss), the loop schedules and the Telegram bot.
- **Postgres** (Docker) holds everything; Prisma is the typed client.
- **Dashboard** (`web/`) is a React app that only talks to the API.

**Why two processes:** Telegram long polling must run in exactly one process, and slow work (Playwright, Claude) should
never make the dashboard slow. The API can still *enqueue* work; the worker *does* it.

**Key files:** `server/src/contracts.ts` (every shared type), `server/prisma/schema.prisma` (every table),
`docs/SPRINT.md` (the flow on one page).

**Q: Why a queue instead of just calling functions?**
A: Retries, scheduling and crash safety. If Claude times out or the worker restarts, pg-boss retries the job with
backoff. Because every step is idempotent (unique keys, atomic updates), a retry never duplicates anything. And pg-boss
uses Postgres, so there's no Redis to run.

---

## 2. Contracts (`server/src/contracts.ts`)

**What:** One file with all statuses, API request/response shapes and the function signatures modules use to call each
other. The web app imports it too (via an `@contracts` alias).

**Why:** Three parts (backend, integrations, frontend) were built in parallel. Agreeing on types first meant each part
could be built and tested alone, and TypeScript catches any drift between server and dashboard.

**Q: Why are statuses strings and not Postgres enums?**
A: They're validated in code against lists in contracts.ts. Adding a status is a code change, not a database migration,
and the same list drives the dashboard's labels.

---

## 3. Database (`server/prisma/`)

**What:** `Job` (what was found), `Application` (created when a card goes to Telegram), `ResumeVariant` / `ResumeVersion`
(base resumes and per-job tailored versions), `Question` / `Answer` (form questions and the answer bank), `AgentAction`
(activity log), `TelegramMessage`, `Loop`, `Settings` (one row), `SourceFetch` (rate-limit memory), `AiCall` (cost log).

**Why:** A Job has a *stage* (discovered → scored / filtered_out → pushed); an Application has a *status* (the
CLAUDE.md flow: pending_approval → needs_answers → approved → applied …). Splitting them keeps "jobs I'm browsing" apart
from "things I've decided to apply to".

**Q: How do you stop the same job being added twice?**
A: A `dedupeKey` column (normalized company + title + URL) with a unique index. Two loop runs racing to insert the same
job hit the unique constraint (Prisma error P2002), which the pipeline counts as a duplicate instead of crashing.

---

## 4. Discovery (`server/src/discovery/`)

**What:** One adapter per source (Greenhouse, Lever, Ashby, Remotive, Remote OK, Himalayas, Arbeitnow, We Work
Remotely RSS, Adzuna, JSearch). Each turns that API's JSON into one common `RawJob` shape.

**Why:** Official APIs and feeds only, each source's terms recorded in DECISIONS.md. A central rate guard
(`SourceFetch` table + per-source minimum interval) means no source is called more often than its terms allow, e.g.
Remotive asks for at most 4 calls a day.

**Key files:** `index.ts` (`runDiscovery`), `meta.ts` (limits + attribution per source), one file per source.

**Q: How do you test code that calls external APIs?**
A: HTTP is injected. Each adapter has a pure `map(body)` function tested on saved real responses in
`tests/fixtures/discovery/`. Tests never touch the network, so they're fast, free and never flaky.

---

## 5. Filters (`server/src/filters/`)

**What:** Pure functions that decide keep/drop *before* any AI cost: salary floor per currency (unknown salary is kept
and tagged), notice period (I have 60 days: "immediate joiners" or "join within 30 days" is dropped), senior titles,
loop locations (Bengaluru counts as India; "Remote - US only" doesn't count as remote for me), excluded title words.

**Why:** Company boards return *every* job a company has. In the first real run, a "Remote" loop found 1,108 jobs;
filters left 38. Scoring 1,108 jobs would waste money and bury the good ones.

**Q: How do you avoid dropping good jobs by mistake?**
A: Only hard, explicit signals drop a job. Soft ones only add a tag (`notice_risk`, `seniority_risk`,
`salary_unknown`) and the AI score plus my own eyes decide. Every drop records a human-readable reason that the
dashboard shows, and `npm run jobs:refilter` re-applies filters after I change them.

---

## 6. Scoring (`server/src/scoring/`)

**What:** Claude Haiku 5.5 reads the JD and my resume and returns match %, matched/missing skills and red flags
(seniority, location, visa, notice, salary), forced into a Zod schema (structured output).

**Why:** The cheapest model is enough for grading. Thinking is turned off and `max_tokens` capped. Every call is logged
in `AiCall` with token counts **before** validating, because a bad answer is still billed. A daily cap (60) limits cost.

**Q: Why validate output if the API already forces the schema?**
A: Never trust model output. The answer can be cut off (`max_tokens`) or out of range, so Zod re-checks it and an invalid
score is rejected without touching the job.

---

## 7. Tailoring (`server/src/tailor/`)

**What:** Claude Sonnet 5.5 picks the most relevant bullets for this job and rewords/reorders them. Its output is not
free text: each bullet says *which* real bullet (`sourceBulletId`) it came from.

**Why: "never invent experience" is enforced in code** (`validate.ts`):
1. every bullet id exists in `resume.json`, under the right job/project;
2. no bullet is used twice;
3. every number in a rewrite (40%, 3, 2.5) appears in the original bullet;
4. every skill listed is one I actually have.

If anything fails, it retries once with the violations listed, then gives up. An invalid version is never saved.
Tailoring only happens when I tap [View resume] or [Apply], so skipped jobs cost nothing.

**Q: What stops the model from saying you improved something by 60% when it was 40%?**
A: Rule 3. Numbers are compared as whole tokens against the source bullet, so "60%" isn't in "...by 40%" and the
version is rejected, and "40" can't sneak in where the source said "400".

### 7b. Refine chat (`server/src/tailor/refine.ts`, `web/src/components/jobs/ResumeTab.tsx`)

**What:** A chat box on the Resume tab. "Lead with backend work", "make it shorter", "drop the cover note" → Sonnet
returns `{ reply, changed, tailored }` and a new version appears, with its own PDF. Older versions stay in a picker and
can be made current again.

**Why it can't invent:** the output goes through the **same validator** as tailoring. Ask "add Kubernetes" and the
model is told not to; if it does anyway, the validator rejects it (one retry), nothing is saved, and the reply says why.
Refines count toward the same daily cap, and if the form was already filled with the old resume, it's filled again
so I never submit a resume I didn't see.

**Q: Why is restoring an old version a copy instead of just pointing back to it?**
A: History stays a straight line: the newest version is always the current one, and every version records where it
came from (`parentId`) and why (`instruction`). It's also free, with no AI call, just a PDF render.

---

## 8. Resume PDF (`server/src/pdf/`)

**What:** Builds a single-column HTML resume (contact + education from the source, bullets from the tailored version)
and prints it to A4 with Playwright.

**Why:** ATS parsers read real text in a simple layout. All text is HTML-escaped, so model output can never inject markup.
The HTML builder is a pure function, so it's unit-tested without a browser.

**Q: Why Playwright for PDFs instead of a PDF library?**
A: It's already in the stack for form filling, and HTML + CSS is far easier to style and test than drawing a PDF by hand.

---

## 9. Queue and pipeline (`server/src/queue/`)

**What:** pg-boss queues: `loop.run` (discover → dedupe → filter → enqueue scoring), `job.score`, `job.push` (create the
Application, send the Telegram card), `resume.tailor`, `apply.prescan`, `apply.fill`. Each active Loop gets a cron
schedule (default every 6 h).

**A/B:** a Loop can list two resume variants. Each new application gets the variant with the fewest applications so far
(A, B, A, B...). The Loop page shows reply rate per variant, with a warning while samples are small.

**Q: What happens when the daily scoring cap is hit?**
A: Jobs stay `discovered`. The next run re-queues that backlog first, so nothing is lost. The worker returns "capped"
instead of throwing, so pg-boss doesn't retry into the same wall.

---

## 10. Telegram bot (`server/src/telegram/`)

**What:** Job cards with `[Apply] [Skip] [View resume]`, form questions, the "Ready to submit" card, and `/status`,
`/pending`, `/pause`, `/resume`. Uses long polling (grammY), so no public URL is needed.

**Why:** It's the only place approvals happen. It obeys only my chat: the first `/start` saves my chat id with
`updateMany where chatId is null`, so two racing `/start`s can't both win, and every other chat is ignored.

**Q: What if you tap [Apply] twice?**
A: The tap is one atomic update ("set approvedAt where status = pending_approval and approvedAt is null"). The second tap
updates zero rows and does nothing, so the work is queued exactly once.

---

## 11. Answer bank (`server/src/answers/`)

**What:** Saved answers for form questions (notice period, CTC, links, work authorization...). Seeded from
`data/private/answers.json`, then grows as I answer new questions.

**How a question is answered:**
1. exact match on the normalized question, or a saved phrasing that covers most of it;
2. otherwise Haiku picks a matching saved answer *key* (it never sees or writes answer text) or says "none";
3. otherwise it's sent to me on Telegram. I reply roughly, Sonnet fixes grammar and tone, and a code check rejects the
   polish if it added any number, URL, email or name that wasn't in my words. I choose `[Use] [Edit] [Use my original]`.

**Q: How do you know the AI didn't add facts while "polishing"?**
A: Code compares facts, not vibes: every number, URL, email and mid-sentence proper noun in the polished text must
appear in my raw answer, or the polish is thrown away and my original is offered.

---

## 12. Applying (`server/src/apply/`)

**What:**
- `prescan.ts` opens the form (Greenhouse / Lever / Ashby) and reads every field: label, type, required, options.
  Standard fields (name, email, phone, resume, LinkedIn) map to `resume.json`.
- `start.ts` (after [Apply]): ensures the tailored PDF, pre-scans, answers what it can from the bank, asks me the rest,
  all at once, so no browser is held open waiting for me.
- `fill.ts` + `filler.ts`: fills the form, uploads the PDF, screenshots it, and **submits only through one gate**.
- `manual.ts`: anything it can't do (Indeed, Workday, CAPTCHA, unknown form) becomes a kit: link + PDF + all answers.

**The submit gate:** submit only if all of these hold:
1. my [Apply] tap (`approvedAt`);
2. my [Submit] tap on the screenshot card (`submitApprovedAt`);
3. DRY_RUN is off (it's on by default);
4. the atomic lock is won (`submitLockedAt`, set only where it's still null).

The daily cap (max 15) is checked first. A failed or unclear submit is never retried; it goes to manual for me to check.

**Q: Your worker crashes right after clicking submit. What happens on retry?**
A: The lock is already set but no result was recorded, so the outcome is unknown. After a stale window the application
moves to `manual` with a note to check, and it is never submitted again automatically. Double-applying is worse than
asking me.

**Q: Most of these forms have reCAPTCHA. How do you handle it?**
A: Greenhouse and Ashby load *invisible* reCAPTCHA on almost every form, so treating its presence as a blocker would make
everything manual. Pre-scan only blocks on a *visible* challenge; if a challenge appears or no confirmation page shows
up after submit, the application goes manual.

---

## 13. REST API (`server/src/api/`)

**What:** Express routes for everything the dashboard shows: jobs, applications, questions, answers, activity, loops,
settings, PDFs and screenshots. Inputs validated with Zod; database rows mapped to contract types in `mappers.ts`.

**Why:** There's deliberately **no route** that approves or submits (a test asserts those paths return 404). The
dashboard can send a card to Telegram, tailor or skip, but approvals stay on Telegram. Screenshot paths are served by
file name only, so `../` tricks can't read other files. The daily cap is clamped to 15 on the server.

**Q: Why can't you approve from the dashboard? Isn't that more convenient?**
A: One approval channel is a hard rule. If a dashboard bug or a stray click could submit an application, the safety
story falls apart. Telegram taps are recorded per application, and that record is what the submit gate checks.

---

## 14. Dashboard (`web/`)

**What:** React + TypeScript + Tailwind v4. Pages: Overview, Loops (with A/B), Jobs (table + drawer), Applications
(board/table + manual kit), Questions (pending + answer bank), Activity, Settings. ⌘K command palette, collapsible sidebar.

**How:**
- **Server state:** TanStack Query, with optimistic updates for toggles (loop on/off, dry run).
- **Drawers:** driven by URL params (`?job=12`), so links, the back button and the palette all work.
- **Motion:** subtle and respects `prefers-reduced-motion`.
- **Accessibility:** Radix primitives for dialogs, focus traps and keyboard support.
- **Demo mode:** `npm run demo` swaps the API for an in-memory mock with the same routes and types, used for screenshots
  and presentations; the sidebar says "Demo data".

**Q: How did you build the UI before the backend existed?**
A: Both sides share `contracts.ts`. The frontend built against a mock server that implements the same routes and types,
and switching to the real API is one environment variable. When the real API came up, the only fixes needed were
product ones (like hiding filtered-out jobs by default), not type mismatches.

---

## 15. Testing

**What:** 333 tests (300 server, 33 web), all offline:
- **Unit:** filters, validator, normalization.
- **Database:** a separate test database, wiped before each test.
- **API:** supertest.
- **Real Chromium:** pre-scan and fill against saved Greenhouse/Lever/Ashby pages.
- **End to end:** [Apply] → questions → Telegram reply → polish → fill → screenshot, nothing submitted.
- **Web:** component tests against the mock API.

**Why:** Claude, Telegram, Playwright and HTTP are all injected, so tests use fakes. No API cost, no flakiness, and CI
needs no keys.

**Q: How do you test something that's supposed to never happen, like a double submit?**
A: Make it happen in the test. Run fill twice in parallel against the same application with a fake filler that counts
submits, then assert the count is exactly 1. The same goes for a dry run (submits = 0) and a missing [Submit] tap
(submits = 0).
