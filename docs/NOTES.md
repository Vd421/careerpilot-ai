# My Learning Notes (plain English)

---

## Step 0: Git + GitHub

- **Git** = save points for code. Each save point is a **commit**.
- **GitHub** = online copy of those save points (backup + portfolio).
- **`.gitignore`** = list of files git must never save (passwords, personal data, downloaded libraries).
- **push** = send my commits to GitHub.

Daily commands:
```bash
git status                 # what changed?
git add <files>            # pick what to save
git commit -m "message"    # save it
git push                   # send to GitHub
```

---

## Step 1: A server + a test

### What a server is
A program that waits for requests and sends back answers.
Think **restaurant**: customer asks for a dish → kitchen checks the menu → hands it over.

### Words
| Word | Meaning |
|---|---|
| **Request** | Customer asking for something (`GET /health`) |
| **GET** | "Give me something" type of request |
| **Path / route** | Which dish (`/health`) |
| **Response** | What we send back |
| **Status code** | 200 = OK, 404 = not found, 500 = we broke |
| **JSON** | The format data travels in: `{ "status": "ok" }` |
| **Port** | The door number the server listens on (3000) |

### Files
- `src/app.ts`: builds the app and its menu (routes). Does **not** start it.
- `src/index.ts`: starts the app on a port.
- Split so **tests can use the app without opening a real port**.

### A route
```ts
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});
```
"When someone GETs `/health`, send back `{ status: "ok" }`."
`req` = what came in. `res` = how I reply.

### Tests
A test = code that checks my code. "When I do X, I expect Y."
```ts
const res = await request(app).get("/health");  // fake visit
expect(res.status).toBe(200);                    // success?
expect(res.body).toEqual({ status: "ok" });      // right answer?
```
- `toBe` → exact same thing (numbers, strings).
- `toEqual` → same contents (objects, arrays).
- **Write the test first, watch it fail, then make it pass.** (red → green = TDD)
- A test with no `expect` checks nothing, so it always "passes." Don't trust it.

### Tools
| Tool | Job |
|---|---|
| Node.js | Runs JavaScript on my computer (not just in a browser) |
| Express | Handles requests/routes |
| TypeScript | JavaScript + types; catches mistakes before running |
| tsx | Runs `.ts` files directly, restarts on save |
| Vitest | Runs tests |
| supertest | Sends fake requests to my app in tests |
| npm | Installs libraries, runs scripts |

### Gotcha
`import { app } from "./app.js"`: the file is `app.ts` but I write `.js`,
because after compiling it **becomes** `app.js`, and that's what Node runs.

---

## Step 2: The database ✅

### Why
Without a database, the server forgets everything when it stops.

### The pieces
| Piece | Plain English |
|---|---|
| **PostgreSQL** | The database. Stores data in tables (like Excel sheets). |
| **Docker** | Runs Postgres inside a box, so I don't install it on Windows. |
| **docker-compose.yml** | Recipe for that box: which image, password, port. |
| **Prisma** | Lets TypeScript talk to Postgres with autocomplete + types, no raw SQL. |
| **schema.prisma** | Where I describe my tables. |
| **Migration** | A saved change to the database structure (like a git commit for tables). |
| **`.env`** | Secret settings (DB password/URL). Never committed. |
| **`.env.example`** | Fake template of `.env` that IS committed, so others know what to fill in. |

### Two databases
- `careerpilot` = my real dev data.
- `careerpilot_test` = tests only. Tests wipe it freely.
- Same Postgres box, two databases.

### Key files
- `src/db.ts`: creates **one** shared Prisma client (many clients = too many DB connections).
- `prisma.config.ts`: tells Prisma where the schema/migrations are and which DB URL to use.
- `vitest.config.ts`: makes tests use `.env.test` (the test DB).
- `tests/global-setup.ts`: before tests, updates the test DB to the latest schema.

### Commands
```bash
docker compose up -d     # start Postgres (run from project root)
docker compose down      # stop it (data is kept)
npm run db:migrate       # after editing schema.prisma: create + apply a migration
npm run db:studio        # open a web UI to see my tables
npm test                 # run tests
```

### Gotchas
- `npm` said "latest" Prisma was a **release candidate** (beta). Always use stable versions for real projects.
- `prisma init` also dumped AI-editor files. Always read what a generator creates before committing.

### The Job model → real SQL
```prisma
model Job {
  id          Int      @id @default(autoincrement())
  company     String
  title       String
  url         String?
  description String
  createdAt   DateTime @default(now())
}
```
| Prisma | Becomes in SQL | Plain English |
|---|---|---|
| `@id @default(autoincrement())` | `SERIAL PRIMARY KEY` | Auto number 1, 2, 3… Unique per row |
| `String` | `TEXT NOT NULL` | Required text |
| `String?` | `TEXT` | The `?` = optional, can be `null` |
| `@default(now())` | `DEFAULT CURRENT_TIMESTAMP` | DB fills in the time |

- A **model** = a table. A **field** = a column. One saved job = a **row**.
- `npm run db:migrate` compares schema vs DB → writes `migration.sql` → runs it.
- Migration files ARE committed: they're the history of my tables.

### Talking to the DB with Prisma
```ts
await prisma.job.create({ data: { company: "Stripe", ... } });   // INSERT
await prisma.job.findUnique({ where: { id: 1 } });               // SELECT one
await prisma.job.deleteMany();                                   // DELETE all
```
- Everything with the DB is **`await`**: it takes time (talking over the network), so we wait for the answer.
- `findUnique` returns the job **or `null`** if nothing matches.

### Test anatomy (DB tests)
| Piece | Why |
|---|---|
| `beforeEach(deleteMany)` | Empty table before every test → tests don't mess with each other |
| `afterAll($disconnect)` | Close the DB connection, or the test run hangs |
| `found?.company` | `?.` = "if `found` is null, don't crash, just give undefined" |
| `expect(found).not.toBeNull()` | First check it exists at all |
| `toBeNull()` | Check the optional `url` really is empty |

### How to trust a test
Break it on purpose (expect "Google" instead of "Stripe") → it should **fail**.
Put it back → it **passes**. If it never fails, it's not testing anything.

---

## Step 3: resume.json ✅

### Why JSON, not the PDF
A PDF is a picture of text; code can't reliably tell a bullet from a skill.
JSON is structured, and **every bullet has an id**:
```json
{ "id": "hapticware-2", "text": "Engineered prompt engineering workflows ... by 40% ..." }
```
Later, Claude must say "I rewrote `hapticware-2` as …". Our code checks that id exists.
Invented bullet → no real id → **rejected**. The "never invent" rule is enforced by code, not trust.

### Where things live
| File | In git? | What |
|---|---|---|
| `data/private/resume.json` | ❌ never | My real resume |
| `data/resume.example.json` | ✅ | Fake person, used by tests (CI won't have my real file) |
| `server/src/resume/schema.ts` | ✅ | The shape rules (Zod) |
| `server/src/resume/load.ts` | ✅ | `loadResume(path)`: read → parse → validate → check ids |

### Zod (new tool)
Checks data **while the program runs**. TypeScript only checks my code **before** it runs;
it can't see inside a JSON file I edit by hand. Zod can.
```ts
const bulletSchema = z.object({ id: z.string().min(1), text: z.string().min(1) });
export type Resume = z.infer<typeof resumeSchema>;   // TS type made FROM the schema
```
- `.optional()` = field can be missing. `.nullable()` = field can be `null` (I use `end: null` for a current job).
- `z.infer` → write the shape once, get runtime checks AND the TS type. They can't drift apart.
- Bad file → clear error: `✖ expected string, received undefined → at experience[0].company`

### loadResume: fail fast, fail clearly
4 things can go wrong, each gets its own message:
1. File missing → `Cannot read resume file`
2. Not valid JSON → `Resume is not valid JSON`
3. Wrong shape → Zod's message (which field, what's wrong)
4. Duplicate id → `Duplicate id in resume: "acme-1"`

`ResumeError` = my own error type, so other code can tell "bad resume" apart from other crashes.

### Why unique ids matter
If two bullets both had id `acme-1`, a tailored bullet pointing to `acme-1` could come from either.
Can't trace it → can't verify it. So ids must be unique across the **whole** resume.

### Testing bad input
Good tests don't just check the happy path. Most of my resume tests feed in **broken** files:
copy the example → break one thing → write to a temp folder → expect a specific error.

### Lesson from this step
One test failed first run: I expected `experience.0.company`, Zod actually says `experience[0].company`.
**The code was right, the test was wrong.** When a test fails, check both sides.

### Commands
```bash
npm run resume:check     # after editing my real resume, validate it
```

### Q&A from Step 3
**Why do tests use a fake resume?**
1. Privacy: my real resume never goes to git.
2. CI (GitHub Actions) only has what's in git → my real file doesn't exist there → tests would crash.
3. Tests need data that **never changes**. I'll edit my real resume often; that shouldn't break tests.

**`null` vs missing**
- `null` = "known to be empty" → `"end": null` means **current job**.
- missing = "not given / unknown".
- `end` uses `.nullable()` (not `.optional()`), so I **must** write it: a date or `null`.
  Forgetting it is an error, so "still working here" can't be confused with "forgot the date".

---

## Step 4: Scoring a job with Claude ✅

### What it does
JD + my resume → Claude → `{ matchScore, summary, matchedSkills, missingSkills, redFlags }` → saved on the Job.
```bash
npm run score -- ../data/private/jds/sample.txt "Acme" "Backend Engineer"
```

### Words
| Word | Plain English |
|---|---|
| **API key** | Password that lets my code use Claude. Lives in `.env`. Costs money per use. |
| **Token** | A chunk of text (~¾ of a word). I pay per token, in and out. |
| **Prompt** | The instructions + data I send. `system` = the rules, `user` = this specific resume + JD. |
| **Structured output** | Claude is **forced** to answer in my exact JSON shape (my Zod schema). No messy text parsing. |
| **max_tokens** | Hard limit on answer length. Caps the cost of one call. |

### Model choice
Haiku 4.5 = cheapest ($1 in / $5 out per million tokens). One score ≈ 4k in + 400 out ≈ **₹0.5**.
Model names live in ONE place: `src/ai/client.ts`.

### Dependency injection (big interview topic)
`scoreJob(jobId, resume, model)`: the Claude call is **passed in**, not hard-coded.
- Real app → passes the real Claude function (default).
- Tests → pass a **fake** that returns a fixed answer.
Why: real calls cost money, give different answers each time, and CI has no API key.
The fake also **records the prompt**, so I can test "did we send the JD?".

### Never trust AI output
Even with structured outputs, I validate again with Zod. Score 150? `null` because it ran out of tokens?
→ `ScoringError`, nothing saved on the Job.

### Log cost BEFORE validating
If the answer is garbage, I still paid for it. So the `AiCall` row (model, tokens) is written first.

### Privacy
The prompt sends my skills/experience, but **not** my name, email or phone. Send only what the task needs.

### Database changes
- `Job` got: `matchScore`, `summary`, `matchedSkills`, `missingSkills` (text lists), `redFlags` (JSON), `scoredAt`.
- New `AiCall` table: one row per Claude call. Linked to a Job (`jobId`); if the job is deleted, the link becomes null (`onDelete: SetNull`), the cost record stays.

### Lazy client
`getClaude()` creates the Claude client the first time it's needed, not when the file is imported.
So tests and the server run fine without an API key.

---

## Frontend vs backend
| | What | Status |
|---|---|---|
| **Backend** (`server/`) | The brain: database, AI calls, logic. Runs on a server, nobody "sees" it. | ✅ Steps 1–4 |
| **Frontend** (`web/`, later) | The face: web pages I click (dashboard, job list, scores). | ⬜ Step 7 |

Backend first because a frontend only **displays** data, and I control the app mainly via **Telegram** (M2).
The frontend will talk to the backend through API routes like `GET /jobs`.

## How to run everything (cheat sheet)
```bash
# from project root
docker compose up -d          # start the database (do this first)
docker compose stop           # stop it (data is kept)

# from server/
npm run dev                   # backend → http://localhost:3000/health
npm run db:studio             # database viewer → http://localhost:5555
npm test                      # all tests (free, uses fake Claude)
npm run resume:check          # validate my resume
npm run score -- <jd.txt> "<company>" "<title>"   # real AI score (needs API key, costs ~₹0.5)
```
Stop a running server in the terminal: **Ctrl + C**.

### First real score: step by step
1. VS Code → **Terminal → New Terminal**
2. `cd server`
3. `npm run score -- ../data/private/jds/sample.txt "Acme" "Backend Engineer"`
   - `--` = "pass the rest to my script"; then: JD file, company, title
4. Wait ~3s → score, summary, matched/missing skills, red flags
5. Paste the output to Claude to sanity-check

| Error | Fix |
|---|---|
| `ANTHROPIC_API_KEY is not set` | Key missing in `server/.env`, or file not saved |
| `ECONNREFUSED` / can't reach DB | Run `docker compose up -d` from project root first |
