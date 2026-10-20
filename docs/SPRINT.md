# Sprint 1: v1 usable for real applications

Started 2026-10-20. Lead = Opus 5.5; teammates = Sonnet. Contracts: `server/src/contracts.ts`.

## Flow (what "v1" means)

```
Loop (cron, pg-boss) or pasted JD
  → discovery adapters → dedupe → cheap pre-filters (title/salary/notice/location)
  → score (Haiku, capped/day) → threshold filter
  → push: create Application(pending_approval) → Telegram card [Apply] [Skip] [View resume]
[View resume] → tailor (Sonnet 5.5, bullet-id checked) → PDF → sent to Telegram
[Apply]   → approvedAt set → tailor+PDF if missing → pre-scan form
            ├─ not greenhouse/lever/ashby, captcha, unknown form → status manual (link + PDF + answers)
            └─ questions: bank match → else ask on Telegram → I reply → polish → [Use][Edit][Use my original]
          → all answered → status approved → fill form + screenshot
            ├─ DRY_RUN=true  → stop, screenshot to Telegram + dashboard
            └─ DRY_RUN=false → "Ready to submit" card [Submit] [Cancel] → lock → submit → applied
```

## Safety rules enforced in code (tests required for each)
1. Submit only if `approvedAt` AND `submitApprovedAt` are set for that application, `dryRun` is false, and the atomic
   `submitLockedAt` update succeeded (`updateMany where submitLockedAt is null`). A retry never double-submits.
2. Daily cap: count of `applied` today < min(settings.dailyCap, 15), else `apply.blocked_cap` + stays approved.
3. Only `approved = true` answers fill a form. Never a guessed value.
4. Tailored bullets: every id real, every number present in the source bullet, skills from resume only.
5. No LinkedIn/Naukri code anywhere. Indeed (via JSearch) is discovery-only → manual.
6. Every step writes an `AgentAction`.

## Ownership

| Folder | Owner |
|---|---|
| `docs/`, `server/src/contracts.ts`, `server/src/{ai,scoring,resume,cli}/`, `server/src/{app,index,worker,db}.ts`, `server/tests/helpers/`, `server/package.json`, root `package.json`, README, `.env.example`, `data/*.example.json` | **lead** |
| `server/prisma/`, `server/src/{api,tailor,pdf,queue,filters}/`, `server/tests/{api,tailor,pdf,queue,filters}/` | **backend** |
| `server/src/{telegram,discovery,apply,answers}/`, `server/tests/{telegram,discovery,apply,answers,e2e}/`, `server/tests/fixtures/` | **integrations** |
| `web/` | **frontend** |

Teammates don't commit, don't `npm install` in `server/` (ask lead), and don't edit outside their folders.

## Tasks

### backend
| # | Task | Depends on |
|---|---|---|
| B1 | Seed script (`npm run db:seed`): Settings row, ResumeVariant "A" → `data/private/resume.json`. Schema + first migration done by lead; backend owns later changes | - |
| B2 | `filters/`: salary normalize + floor (unknown → `salary_unknown` tag), notice regex (<60d → drop), seniority (title keywords + "N+ years"), remote/location, excludeKeywords, dedupeKey | B1 |
| B3 | `tailor/`: Sonnet 5.5 structured output → `TailoredResume`, validator (4 rules in contracts), AiCall logging, ResumeVersion row, daily cap | B1 |
| B4 | `pdf/`: resume HTML template → Playwright `page.pdf()` → `data/private/pdfs/<id>.pdf` | B3 |
| B5 | `queue/`: pg-boss setup, workers for `QUEUES`, loop scheduler (cron per active Loop), pipeline (discover → dedupe → filter → score → push), score cap | B2, I2 |
| B6 | `api/`: every route in contracts.ts, mounted in `app.ts` by lead; serve PDFs + screenshots | B1–B5 |

### integrations
| # | Task | Depends on |
|---|---|---|
| I1 | `telegram/`: grammY client (`TelegramClient`), long-polling bot, chat-id capture on /start, job card, button handlers, /status /pending /pause /resume | B1 |
| I2 | `discovery/`: one adapter per source + `SOURCE_META` (ToS notes), `runDiscovery`, SourceFetch rate guard, fixture tests | - |
| I3 | `answers/`: seed from `data/private/answers.json`, normalize + match (patterns, then Haiku classifier that may only pick an existing approved answer), polish (Sonnet 5.5, "no new facts" check), approve flow | B1 |
| I4 | `apply/` pre-scan: Playwright readers for Greenhouse / Lever / Ashby, captcha + unknown-form detection → `PrescanResult` | - |
| I5 | `apply/` fill + submit: `FormFiller.fill`, screenshot, safety rules 1–3, `startApplication` orchestration, manual path | I3, I4 |
| I6 | e2e test: saved Greenhouse fixture → prescan → bank + fake Telegram answer → fill → screenshot, nothing submitted | I5 |

### frontend
| # | Task | Depends on |
|---|---|---|
| F1 | Scaffold `web/` (Vite, React, TS, Tailwind v4, tokens, Geist, shadcn restyled), `@contracts` alias, typed API client with mock mode | - |
| F2 | App shell: collapsible sidebar, Recent list, status footer, ⌘K palette, route transitions | F1 |
| F3 | Overview + Activity | F2 |
| F4 | Jobs table + drawer, "+ New job" paste dialog | F2 |
| F5 | Applications + Questions (Pending / Answer bank) | F2 |
| F6 | Loops (cards, multi-step form, detail with A/B) + Settings | F2 |

### lead
L0 contracts + schema + deps (this file) · L1 wire `app.ts` / `worker.ts` / `dev:all` · L2 integration + full test run ·
L3 WALKTHROUGH.md, README, `.env.example`, ROADMAP, DECISIONS · L4 commits per task

## Status
- [x] L0 (lead) Phase 0
