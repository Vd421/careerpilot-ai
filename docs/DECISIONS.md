# Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-10-01 | Resume stored as `resume.json` with bullet ids | Makes "never invent experience" checkable in code |
| 2026-10-01 | Form questions go through an answer bank + Telegram Q&A, with Claude polishing only | Forms have custom questions; the agent must never make up answers |
| 2026-10-01 | Pre-scan form questions before asking the user | Can't keep a browser session open for hours waiting on a reply |
| Open (M5) | Gmail API vs IMAP/SMTP app password | Gmail OAuth refresh tokens expire every 7 days in Testing mode |
