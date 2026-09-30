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
- [ ] Step 4: score a JD against the resume with Claude (cheap model) → match %, missing skills, red flags; save on `Job`
