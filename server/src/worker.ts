// Worker process: pg-boss workers + loop schedules + Telegram long polling.
// Kept apart from the API so only ONE process ever polls Telegram, and slow jobs
// (Playwright, Claude calls) never block dashboard requests.
import "dotenv/config";
import { prisma } from "./db.js";
import { startQueue, stopQueue } from "./queue/index.js";
import { startBot, stopBot } from "./telegram/index.js";

await startQueue(); // registers every worker and syncs each active Loop's cron
await startBot(); // no TELEGRAM_BOT_TOKEN → logs a warning and keeps running without Telegram

console.log("Worker running: queue workers + loop schedules + Telegram bot");

async function shutdown() {
  await stopBot();
  await stopQueue();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
