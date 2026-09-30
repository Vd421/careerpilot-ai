# Roadmap

## Current: Milestone 1 (Match + tailor)

### Done
- [x] Project brief (CLAUDE.md), .gitignore, git init, pushed to GitHub
- [x] Step 1: server scaffold (TypeScript + Express + Vitest), `GET /health` + test
- [x] Step 2: Postgres (Docker) + Prisma 7, `Job` model + migration + tests
- [x] Step 3: `resume.json` format (Zod schema), `loadResume()` with unique-id check, `npm run resume:check`, tests

### Tomorrow (me, in order)
1. [ ] `docker compose up -d` (from project root) to start the database
2. [ ] console.anthropic.com → add $5 credits → set a monthly spend limit → create an API key
3. [ ] Paste the key into `server/.env` after `ANTHROPIC_API_KEY=` (never in chat)
4. [ ] From `server/`: `npm run score -- ../data/private/jds/sample.txt "Acme" "Backend Engineer"` → paste the output to Claude, check the score makes sense
5. [ ] Try it on a real JD I care about (save it in `data/private/jds/`)
6. [ ] Replace `data/private/resume.json` with my latest resume (+ current job?) → `npm run resume:check`

### Next
- [ ] Step 5: tailor resume for a job (better model) → rewritten bullets that must reference real bullet ids
