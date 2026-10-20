# Roadmap

## Your next steps (in order)

1. [ ] **Look at it:** `npm run demo` → http://localhost:5173 (sample data, nothing else needed)
2. [ ] **Real resume check:** `cd server && npm run resume:check` (it must pass; tailoring uses its bullet ids)
3. [ ] **Answer bank:** `cp data/answers.example.json data/private/answers.json`, fill in notice period, expected CTC,
       location, work authorization, links → `cd server && npm run db:seed`
4. [ ] **Telegram:** @BotFather → `/newbot` → token into `server/.env` as `TELEGRAM_BOT_TOKEN`
5. [ ] **Run it:** `npm run dev:all` → send `/start` to your bot → the sidebar dot turns green
6. [ ] **First real dry run** (DRY_RUN is on, nothing gets submitted):
   - the 2 loops already exist ("Full Stack AI · Remote", "DevOps · India") with 51 jobs waiting to be scored;
     the worker scores them (Haiku 5.5, cents) and sends cards ≥ 65% to Telegram
   - pick one **Greenhouse** job → [View resume] (check the tailored PDF) → [Apply] → answer any question on Telegram →
     check the "Dry run: filled" screenshot looks right
   - if the screenshot is right on 2–3 jobs, consider turning DRY_RUN off in Settings
7. [ ] Optional keys: Adzuna (`ADZUNA_APP_ID`/`ADZUNA_APP_KEY`), JSearch (`RAPIDAPI_KEY`) for India/Indeed listings

## Done

### Sprint 1 (2026-10-20 → 21): v1 usable for real applications
- [x] Contracts, schema (Application, ResumeVariant/Version, Question, Answer, AgentAction, TelegramMessage, Loop, Settings)
- [x] Discovery: 10 official sources, ToS rate guard, dedupe, paste JD/URL
- [x] Filters: salary floor, notice period, seniority, loop locations, excluded words
- [x] Scoring on Haiku 5.5 with notice/salary red flags; daily cap
- [x] Tailoring on Sonnet 5.5 with bullet-id / number / skill validation; ATS PDF
- [x] Telegram bot: cards, [Apply]/[Skip]/[View resume], Q&A, [Submit]/[Cancel], /status /pending /pause /resume
- [x] Answer bank: seed, matching, polish with no-new-facts check
- [x] Apply: pre-scan, fill, screenshot, two-tap submit gate, atomic lock, daily cap, manual kit
- [x] Loops on pg-boss cron, pause/resume, per-loop stats, resume A/B rotation
- [x] Dashboard: Overview, Loops, Jobs, Applications, Questions, Activity, Settings, ⌘K, demo mode
- [x] 316 tests (286 server incl. real-Chromium form tests + e2e, 30 web), `npm run dev:all`, README, WALKTHROUGH

### Before the sprint
- [x] Server scaffold, Postgres + Prisma, `resume.json` schema + loader, scoring CLI

## Known gaps (from QA)
- Form filling is tested on saved pages only; **check the first live dry runs by eye** (dropdown widgets, file upload, confirmation page).
- JSearch and Adzuna response fields were written from their docs (no key yet): check on the first run.
- A job filled during DRY_RUN doesn't get a [Submit] card later when DRY_RUN is turned off: tap [Apply] again on a new job.
- The polish "no new facts" check doesn't catch a new name at the very start of a sentence.
- Web bundle is one ~1 MB chunk (310 KB gzip); fine locally, code-split before deploying.
- Test files aren't type-checked (tsconfig includes `src` only).

## Next (after this sprint, in order)
- [ ] **M5 Inbox tracking:** detect recruiter replies, link to the application, update status (feeds real A/B response rates)
- [ ] **M6 Follow-ups + referrals:** 7-day follow-up drafts, referral asks, send on `[Send]`
- [ ] Recruiter email lookup
- [ ] Deploy: Docker + Railway, GitHub Actions CI
- [ ] 2-min demo video
