# Brief: frontend

Read `docs/briefs/_common.md` first (the testing/DB parts are for server teammates; the rest applies).

**You own:** `web/` only. You may run `npm install` inside `web/`. Don't touch `server/`.
Types come from `server/src/contracts.ts` via a `@contracts` alias (tsconfig paths + Vite `resolve.alias` +
`server.fs.allow: [".."]`). It has no imports, so it's safe to share. Never redefine those types.

## Goal
A calm, product-grade dashboard (think Linear / Notion / Claude.ai). **Follow the design spec below strictly.**
Before writing UI, invoke the `frontend-design` skill (Skill tool) for craft guidance, but the spec here wins on
every conflict. It must look like a real SaaS a design team shipped.

## Data
- Typed client `web/src/lib/api.ts`: one function per route in contracts.ts, `fetch("/api/...")`, throws on `ApiError`.
- Vite dev proxy `/api` → `http://localhost:3000`.
- **Mock mode:** `VITE_MOCK=1` (default while the backend isn't ready) serves realistic fixtures from
  `web/src/mocks/` that satisfy the contract types (≈30 jobs across statuses/sources, 2 loops, questions, answers,
  60 activity items). Switch off when the API is up; nothing else changes.
- TanStack Query for fetching/caching; optimistic updates for toggles (loop on/off, dry run).

## Stack
Vite + React + TypeScript + Tailwind v4 (`@tailwindcss/vite`), react-router, @tanstack/react-query, `motion`
(framer-motion), lucide-react, recharts, cmdk, shadcn/ui components (copy them in, restyle to tokens; Radix
primitives), Geist + Geist Mono (`geist` npm package or @fontsource). Vitest + Testing Library for tests.

## Design spec (strict)
**Feel:** calm, professional, light theme. No neon, no purple/blue AI gradients, no glow, no glassmorphism, no emoji.

**Layout (Claude.ai-style):**
- Left sidebar 260px, collapsible to a 56px icon rail (smooth width transition; remember state in localStorage).
  - Top: "CareerPilot" wordmark + collapse button
  - Primary button "+ New job" (dialog: paste JD text or URL, optional company/title)
  - Nav: Overview, Loops, Jobs, Applications, Questions, Activity, Settings (lucide, 1.5px stroke)
  - "Recent": last 10 jobs, one line each (company · role), like Claude's chat list
  - Bottom: Telegram status dot, daily applications used (e.g. 4/15), profile/settings row
- Main: max-width ~1200px, generous whitespace, 24–32px gutters
- ⌘K / Ctrl+K command palette: jump to a job, search, "Paste JD", navigate pages

**Pages:**
- **Overview:** 4 stat cards (discovered, applied, awaiting me, replies), pipeline funnel, "Needs your attention"
  (pending approvals, questions, ready-to-submit, manual), recent activity
- **Loops:** card per loop: name, filter chips, on/off toggle, next run, mini funnel (found → applied → replied).
  "+ New loop" → clean multi-step form (Basics → Search → Filters → Resume variants → Review). Click → loop detail:
  its jobs, applications, A/B variant comparison (response rate per variant, small bars, sample sizes shown).
- **Jobs:** table: company, role, source, match % (small bar), salary, red-flag chips, status. Filters (status, source,
  loop, search). Row click → right drawer: JD, score breakdown, matched/missing skills, tailored resume preview
  (bullets), PDF link, actions: "Send to Telegram", "Tailor resume", "Skip". **No Apply/Submit button anywhere in
  the UI.** Approvals happen only on Telegram; show a hint "Approve on Telegram" where relevant. Show source
  attribution (from `JobDetail.attribution`).
- **Applications:** board (by status) + table toggle: resume version used, method (auto/manual), applied date,
  screenshot thumbnail (click → lightbox). For manual: apply link + PDF + every answer with a copy button.
- **Questions:** tabs. Pending: questions waiting on me (mirrors Telegram); answer inline → shows polished version →
  Use / Edit / Use my original + "Save for future jobs" toggle. Answer bank: every saved answer, editable,
  reusable vs job-specific filter.
- **Activity:** vertical timeline of AgentActions (what, when, job), filter by type group and job.
- **Settings:** filters (salary floors per currency, notice days, threshold, max years), source toggles (with
  configured / not-configured state), daily cap (max 15), **DRY_RUN switch** (turning it off needs a confirm dialog
  explaining that real applications will be submitted after Telegram approval), Telegram link status.

**Colors (CSS variables → Tailwind theme):**
bg `#FAFAF7`, surface `#FFFFFF`, sidebar `#F3F2EE`, border `#E6E4DE`, text `#1F1E1B`, muted `#6B6862`.
One accent: `#2F6F6B` (hover `#285E5A`), accent tint `#E8F0EF`.
Status (desaturated) + pale tint for chips: success `#3F7D4E`, warning `#A9792B`, danger `#A8463E`, info `#3E6A8A`.

**Type:** Geist Sans (UI), Geist Mono (numbers, ids, dates). 14px base. Headings 600, letter-spacing -0.01em.
`tabular-nums` in tables.

**Components:** shadcn/ui restyled to tokens. Radius 10px cards, 8px inputs. 1px borders instead of heavy shadows;
cards only `0 1px 2px rgba(0,0,0,.04)`; drawers/menus a bigger soft shadow. Recharts in muted tones (accent + greys).

**Motion (`motion`, subtle):** 150–220ms, ease-out, no bounce/spring overshoot. Page content fades + rises 4px on route
change. List rows stagger 20ms. Drawer slides from the right with backdrop fade. Stat numbers count up once on load.
Hover: background tint + 1px border shift, never scale. Skeleton loaders (soft shimmer) instead of spinners.
Respect `prefers-reduced-motion` (disable movement, keep opacity).

**Quality bar:** responsive down to 1024px; fully keyboard-navigable; visible focus rings in accent; every empty state
has one helpful line + one action; no console errors; `npm run build` and `npm run typecheck` clean.

## Tasks
- **F1** Scaffold + tokens + fonts + shadcn base + `@contracts` alias + API client + mock mode. `npm run dev`, `build`,
  `test`, `typecheck` scripts.
- **F2** App shell: sidebar (collapse, Recent, status footer), routing, page transition, ⌘K palette, New job dialog.
- **F3** Overview + Activity.
- **F4** Jobs table + drawer.
- **F5** Applications + Questions.
- **F6** Loops (list, multi-step form, detail with A/B) + Settings.
Tests: component tests for sidebar collapse, Jobs filters, Questions answer flow, DRY_RUN confirm, Loop form validation
(all against mocks). Report after each task with a short note on what to look at.
