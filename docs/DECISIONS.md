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
| Open (M5) | Gmail API vs IMAP/SMTP app password | Gmail OAuth refresh tokens expire every 7 days in Testing mode |
