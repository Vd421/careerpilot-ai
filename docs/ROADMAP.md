# Roadmap

## Current: Milestone 1 (Match + tailor)

### Done
- [x] Project brief (CLAUDE.md), .gitignore, git init, pushed to GitHub
- [x] Step 1: server scaffold (TypeScript + Express + Vitest), `GET /health` + test
- [x] Step 2: Postgres (Docker) + Prisma 7, `Job` model + migration + tests
- [x] Step 3: `resume.json` format (Zod schema), `loadResume()` with unique-id check, `npm run resume:check`, tests

### Todo (me)
- [ ] Replace `data/private/resume.json` with my latest resume (+ current service desk job?), then `npm run resume:check`

### Next
- [ ] Step 4: score a JD against the resume (Haiku 4.5, `messages.parse` + Zod) → save matchScore/summary/skills/redFlags on `Job`, log tokens in new `AiCall` table; tests use a fake Claude client; `npm run score -- jd.txt` for real runs. Plan explained 2026-10-01, not started.
- [ ] **Me:** create Anthropic API key (console.anthropic.com, $5 credits), paste into `server/.env` myself
