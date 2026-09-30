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
