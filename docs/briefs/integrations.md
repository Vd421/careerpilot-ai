# Brief: integrations

Read `docs/briefs/_common.md` first.

**You own:** `server/src/{telegram,discovery,apply,answers}/`, `server/tests/{telegram,discovery,apply,answers,e2e}/`,
`server/tests/fixtures/`.
**You call (owned by backend, typed in contracts.ts):** `tailorForJob`, `renderResumePdf`, `enqueue`. Stub via a
`deps` object until they exist.

## I1. Telegram — `src/telegram/`
grammY (installed), **long polling**. Token: `TELEGRAM_BOT_TOKEN`. No token → bot doesn't start, `TelegramClient`
becomes a no-op logger, `/api/status` shows disconnected.
- `client.ts`: `TelegramClient` implementation sending to `Settings.telegramChatId`. Every outgoing message saved as
  `TelegramMessage(direction "out")`, incoming as "in".
- `bot.ts`: `startBot()`. **Only my chat is obeyed:** first `/start` stores the chat id if none is set; after that every
  update from another chat id is ignored. Commands: `/status` (today's counts, dry run, cap), `/pending`
  (approvals + questions), `/pause` and `/resume` (all loops, or `/pause <loop name>`).
- `sendJobCard(applicationId)`: role, company, match %, 2-line why-it-fits (score summary), red flags, salary, source,
  link. Buttons `CALLBACK.apply/skip/viewResume`. Writes `telegram.card_sent`.
- Handlers: `[Skip]` → status skipped. `[View resume]` → tailor + PDF if missing → send the PDF. `[Apply]` → set
  `approvedAt` (only if status is pending_approval; a second tap is a no-op), `telegram.tap` + `application.approved`,
  then `enqueue(QUEUES.prescan)`. `[Submit]`/`[Cancel]` for the final card (see I5). Answer buttons (see I3).
- Text replies: if a question is "asked" and this message replies to it (match `reply_to_message` → TelegramMessage →
  questionId; else the oldest asked question), treat it as my raw answer.
- Tests with a fake grammY context/`TelegramClient`: chat-id lock, double [Apply] tap, skip, reply routing.

## I2. Discovery — `src/discovery/`
One file per source implementing `JobSource`; `index.ts` exports `SOURCE_META` and `runDiscovery`. Official APIs/feeds
only. HTTP injected (`HttpGet`), real impl = `fetch` with a `User-Agent: CareerPilot (personal job search)` header.
| Source | Endpoint | Notes |
|---|---|---|
| jsearch | RapidAPI `jsearch.p.rapidapi.com/search` | key `RAPIDAPI_KEY`; free tier is small → minInterval ≥ 720 min; applyPlatform from apply link host, else other |
| adzuna | `api.adzuna.com/v1/api/jobs/{in,gb,us}/search/1` | `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`; has salary |
| remotive | `remotive.com/api/remote-jobs?search=` | their docs ask for few calls/day + link back |
| remoteok | `remoteok.com/api` | ToS: link back + credit RemoteOK; first array item is legal notice, skip it |
| himalayas | `himalayas.app/jobs/api` | attribution |
| arbeitnow | `www.arbeitnow.com/api/job-board-api` | |
| weworkremotely | RSS feeds (fast-xml-parser) | programming/devops categories |
| greenhouse | `boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` | company list below |
| lever | `api.lever.co/v0/postings/{company}?mode=json` | |
| ashby | `api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=true` | |

- **Read each source's ToS/API docs** (WebFetch) and put the facts in `SOURCE_META` (`minIntervalMinutes`,
  `attribution`). Send the lead a ToS summary table for DECISIONS.md. If a source forbids this use, leave it out and say so.
- Target companies: `data/target-companies.json` (`{ greenhouse: [], lever: [], ashby: [] }` board tokens). Create
  `data/target-companies.example.json` with ~20 India/remote-friendly tech companies, **verifying each token returns
  200** once. Lead copies it.
- Keyword match: board APIs return all jobs → filter by title containing any loop keyword (case-insensitive,
  with simple synonyms: "SDE" ↔ "software engineer", "full stack" ↔ "fullstack").
- Rate guard: before fetching, check `SourceFetch` for the same source+queryKey within `minIntervalMinutes` → skip.
- HTML → plain text for descriptions. Normalize salary fields to yearly when the source gives a period.
- `fetchJobFromUrl(url)`: for a pasted Greenhouse/Lever/Ashby job URL, fetch that one posting via the public API.
- Tests: one saved JSON/RSS fixture per source in `tests/fixtures/discovery/` (trim to 2–3 jobs, no personal data).

## I3. Answer bank — `src/answers/`
- `seedAnswers()`: from `data/private/answers.json` (format: `data/answers.example.json`); entries with empty answers
  are skipped. Upsert by `key`, `approved: true`, `reusable: true`. Missing file → warning, not crash.
- `normalizeQuestion()`: lowercase, strip punctuation, `*`, "(required)", collapse spaces.
- `matchAnswer(questionText, fieldType, options)`: (1) exact normalized match or pattern containment among approved
  rows; (2) else Haiku classifier that receives ONLY the list of approved answer keys + question texts (not the answers)
  and returns a key or "none" (structured output). Never let the model write the answer. For select/radio, the answer
  must map to one of `options` (case-insensitive / prefix), else treat as unmatched.
- `submitRawAnswer` / `approveAnswer` (contracts): polish with Sonnet 5.5 — grammar and tone only. Then a code check:
  numbers, URLs, emails and capitalized proper nouns in the polished text must all appear in the raw answer; if not,
  discard the polish and offer the original. Telegram shows original + polished with `[Use] [Edit] [Use my original]`.
  `[Edit]` → "Send the edited version" → next reply is saved as-is. Approving creates/updates an `Answer`
  (`approved: true`, `reusable` chosen: ask "Save for future jobs? [Yes] [Only this job]"), links the Question, writes
  `answer.approved`. When an application's last required question is answered → `enqueue(QUEUES.fill)`.
- Tests: normalization, pattern match, classifier fake returns unknown key → unmatched, select option mapping,
  polish that adds a number is rejected.

## I4. Pre-scan — `src/apply/prescan.ts`
`FormFiller.prescan` with Playwright (headless Chromium). Per platform reader:
- Greenhouse: job board URL → the application form (`#application_form` or the newer job-boards layout).
- Lever: `<posting>/apply`. Ashby: `<posting>/application` (React; wait for the form).
- Extract each field: label text, name/id, type, required (asterisk/`required`/`aria-required`), options.
  Standard fields (first/last name, email, phone, resume upload, LinkedIn/GitHub/website) get fixed keys so they map
  to resume.json basics/links without asking me.
- Blockers → `PrescanResult.blocker`: captcha (recaptcha/hcaptcha/turnstile iframes or scripts), login wall,
  unknown layout (no form found) → `unknown_form`; platform "other" → `unsupported_platform`.
- Save fixtures: one real Greenhouse, Lever and Ashby form page as static HTML in `tests/fixtures/forms/`
  (public pages, strip tracking scripts). Tests run prescan against `file://` fixtures.

## I5. Fill + submit — `src/apply/`
- `startApplication(applicationId)` (after [Apply]): ensure ResumeVersion + PDF (tailor/render if missing) →
  platform not auto → `manual` (reason `unsupported_platform`) → prescan → blocker → `manual` → create `Question` rows
  → bank match each (`question.matched_bank`) → unmatched required → ask on Telegram one by one
  (`question.asked`, status `needs_answers`) → all answered → `approved` → enqueue fill.
- `fill` worker: daily cap check → `FormFiller.fill` with answers + PDF. Screenshot full page to
  `data/private/screenshots/<applicationId>-<ts>.png`, set `filledAt`, `screenshotPath`, `apply.filled`.
  - `dryRun` true → never click submit; `apply.dry_run`; Telegram photo "Dry run: filled, not submitted".
  - `dryRun` false and no `submitApprovedAt` → Telegram photo + all answers, `[Submit] [Cancel]`.
  - `[Submit]` tap → set `submitApprovedAt` → `fill` again with `submit: true` only after
    `updateMany({ where: { id, submitLockedAt: null }, data: { submitLockedAt: now } })` returns count 1.
    After submit, detect the confirmation page → `applied`, `appliedAt`, `method auto`, `apply.submitted`, screenshot,
    Telegram "Applied to X at Y" + screenshot. No confirmation → `manual` with reason `error`, never retry submit.
- **Manual path:** status `manual`, `method manual`, Telegram message: link, PDF (sendDocument), and every known
  answer as copyable text. Dashboard shows the same.
- Any exception mid-fill → `apply.failed` with the error + screenshot if possible, status stays, Telegram ping.
- Tests (fake `FormFiller` + fake Telegram): dry run never submits; no submitApprovedAt → no submit; lock prevents a
  double submit; cap reached blocks; captcha → manual; unsupported platform → manual with answers.

## I6. e2e — `tests/e2e/greenhouse.test.ts`
Real Playwright on the saved Greenhouse fixture (`file://`), fake Claude + fake Telegram, real test DB:
job → application → [Apply] → prescan → bank answers 2 questions → 1 unknown question asked via fake Telegram → fake
reply → polish (fake) → approve → fill → screenshot file exists → status `approved`, `submitted: false`, AgentActions in
the right order. Skippable with `SKIP_BROWSER_TESTS=1`.

Order: I2 (no deps) and I4 first → I1 → I3 → I5 → I6. Report after each.
