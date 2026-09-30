# Roadmap

## Current: Milestone 1 (Match + tailor)

### Done
- [x] Project brief (CLAUDE.md), .gitignore, git init, pushed to GitHub
- [x] Step 1: server scaffold (TypeScript + Express + Vitest), `GET /health` + test

### In progress: Step 2 (Postgres + Prisma)
- [x] Postgres in Docker (`careerpilot` dev DB + `careerpilot_test`)
- [x] Prisma 7.10 + shared client (`src/db.ts`), tests auto-use test DB
- [x] `Job` model + first migration (`add_job`)
- [x] Job tests: save + read back, optional url
- [ ] Commit Step 2

### Next
- [ ] Step 3: resume.json format + loader
