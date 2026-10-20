# Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-10-01 | Resume stored as `resume.json` with bullet ids | Makes "never invent experience" checkable in code |
| 2026-10-01 | Form questions go through an answer bank + Telegram Q&A, with Claude polishing only | Forms have custom questions; the agent must never make up answers |
| 2026-10-01 | Pre-scan form questions before asking the user | Can't keep a browser session open for hours waiting on a reply |
| 2026-10-01 | `app.ts` (builds app) split from `index.ts` (listens) | Tests hit the app via supertest without opening a real port |
| 2026-10-01 | ESM + TypeScript `NodeNext`, `tsx` for dev | Matches how Node resolves modules; imports use `.js` extension |
| 2026-10-01 | `.gitattributes` forces LF line endings | Windows dev, Linux in Docker/CI; avoids noisy diffs |
| 2026-10-01 | Postgres via Docker Compose, separate `careerpilot_test` DB | No Windows install; tests can wipe data safely |
| 2026-10-01 | Prisma 7.10 (stable), not npm "latest" (8.0 RC) | Beta tooling breaks in confusing ways |
| 2026-10-01 | Zod validates `resume.json` on load; TS type inferred from the schema | Hand-edited file: fail fast with a clear message, one source for shape + type |
| 2026-10-01 | Ids unique across all experience, projects and bullets | A tailored bullet must trace back to exactly one source bullet |
| 2026-10-01 | Real resume in `data/private/` (gitignored), fake `data/resume.example.json` for tests | Personal data stays out of git; tests work in CI |
| 2026-10-01 | Scoring uses Claude Haiku 4.5 via `messages.parse` + Zod structured output, `max_tokens` 1024 | Cheapest tier (~₹0.5/score); schema-forced JSON; capped cost |
| 2026-10-01 | Model call injected into `scoreJob` (`ScoringModel`), tests use a fake | No API cost, deterministic tests, CI needs no key |
| 2026-10-01 | `AiCall` logged before validating output | Tokens are billed even when the answer is rejected |
| 2026-10-01 | Contact details stripped from the scoring prompt | Send the API only what the task needs |
| 2026-10-20 | Full sprint (M1–M4 + Loops + A/B + dashboard) built by an agent team | User chose shipping over learning; hard rules unchanged |
| 2026-10-20 | Statuses are strings checked against lists in `contracts.ts`, not Postgres enums | Adding a status never needs a migration |
| 2026-10-20 | Job `stage` (before approval) separate from Application `status` (CLAUDE.md flow) | An Application exists only once a card is sent to Telegram |
| 2026-10-20 | Two taps before a real submit: [Apply] starts, [Submit] on the filled-form screenshot sends | Catches a wrong answer-bank match before anything leaves |
| 2026-10-20 | Atomic `submitLockedAt` (updateMany where null) + unique `idempotencyKey` per application | A retry or double tap can never submit twice |
| 2026-10-20 | No approve/submit route in the REST API; only Telegram taps set `approvedAt` / `submitApprovedAt` | Hard rule: never submit without my tap on Telegram |
| 2026-10-20 | Tailor lazily (on [View resume] / [Apply]); caps 60 scores/day, 20 tailors/day | Skipped jobs cost nothing on the better model |
| 2026-10-20 | Scoring on `claude-haiku-5-5`, tailoring/polish on `claude-sonnet-5-5` | Haiku 5.5 is ~10× cheaper than Haiku 4.5; Sonnet for writing quality |
| 2026-10-20 | Two processes: API (`index.ts`) and worker (`worker.ts`: pg-boss + Telegram polling) | Only one process may long-poll Telegram; API stays responsive |
| 2026-10-20 | Per-teammate test DBs via `TEST_DB_NAME` | Parallel test runs would wipe each other with TRUNCATE |
| 2026-10-21 | Tailor validation: real bullet id under its parent, no reused id, every number in the source bullet, skills from resume, headline numbers from resume; 1 retry with the violations | "Never invent" enforced in code, not by the prompt |
| 2026-10-21 | Notice filter drops only hard requirements ("immediate joiner", "join within N<60 days"; "15/30 days" uses the larger); soft wording → `notice_risk` tag | Don't lose jobs that merely prefer an early start |
| 2026-10-21 | `excludeKeywords` match the job title only (whole words) | Descriptions mention "senior engineers" in normal text |
| 2026-10-21 | Remotive fetched with one category request + local title filter | Remotive asks for max 4 calls/day |
| 2026-10-21 | Pre-scan blocks only on a *visible* CAPTCHA; invisible reCAPTCHA/hCaptcha (on almost every Greenhouse/Ashby/Lever form) is allowed, and a challenge or missing confirmation at submit → `manual` | Otherwise every job would be manual; submit failures never retry |
| 2026-10-21 | Standard fields (name, email, phone, resume, LinkedIn/GitHub/website) filled from `resume.json`, never asked | They're facts already in my resume |
| Open (M5) | Gmail API vs IMAP/SMTP app password | Gmail OAuth refresh tokens expire every 7 days in Testing mode |

## Job sources: terms of use (checked 2026-10-21)

All official APIs/feeds. LinkedIn, Naukri and Indeed are never scraped; Indeed listings arrive only through JSearch and are always manual-apply.

| Source | Endpoint | Terms found | Min interval | Attribution |
|---|---|---|---|---|
| JSearch | RapidAPI `jsearch` | RapidAPI plan limits (free tier is small); key needed | 12 h, max 2 searches/run | none; links shown as-is |
| Adzuna | api.adzuna.com | per-plan quota; app id + key | 6 h | "Jobs by Adzuna" link back |
| Remotive | remotive.com/api/remote-jobs | max 4 calls/day, blocked above 2/min; link to listing + credit Remotive; don't republish to other job sites | 6 h | yes |
| Remote OK | remoteok.com/api | followed link back to the Remote OK URL + mention Remote OK, else API access is suspended | 6 h | yes |
| Himalayas | himalayas.app/jobs/api | daily refresh; 429 when over limit; link back + credit; use applicationLink | 12 h | yes |
| Arbeitnow | arbeitnow.com/api/job-board-api | no terms page; descriptions link to Arbeitnow | 6 h | credit kept |
| We Work Remotely | programming + devops RSS | public RSS, robots.txt allows / | 6 h | credit kept |
| Greenhouse | boards-api.greenhouse.io | public GET, no key | 2 h | none |
| Lever | api.lever.co/v0/postings | public GET | 2 h | none |
| Ashby | api.ashbyhq.com/posting-api | public posting API | 2 h | none |

Unverified (no key used during the sprint): JSearch and Adzuna response field names were written from their docs; check them on the first real run.
