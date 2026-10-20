// API process: serves the dashboard. Background work (workers, schedules, Telegram polling) runs in worker.ts.
import "dotenv/config";
import { app } from "./app.js";
import { prisma } from "./db.js";
import { startQueue, stopQueue } from "./queue/index.js";

const PORT = Number(process.env.PORT) || 3000;

// Connect to pg-boss without consuming jobs, so API routes can enqueue (e.g. "score this pasted JD").
await startQueue({ workers: false });

const server = app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});

async function shutdown() {
  server.close();
  await stopQueue();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
