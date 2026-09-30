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
