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
| Open (M5) | Gmail API vs IMAP/SMTP app password | Gmail OAuth refresh tokens expire every 7 days in Testing mode |
