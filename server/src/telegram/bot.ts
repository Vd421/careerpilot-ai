import type { Bot } from "grammy";
import { prisma } from "../db.js";
import { handleCallback, handleCommand, handleText } from "./handlers.js";
import { getBot, getTelegramClient } from "./client.js";
import type { TelegramDeps } from "./types.js";

// ---------------------------------------------------------------------------
// Only MY chat is obeyed. The first /start links the chat if none is saved yet;
// after that every update from any other chat id is ignored (no reply, no log of content).
// ---------------------------------------------------------------------------
export type AuthResult = "ok" | "linked" | "ignore";

export async function authorizeChat(chatId: number | string, isStart: boolean): Promise<AuthResult> {
  const id = String(chatId);
  const s = await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  if (s.telegramChatId) return s.telegramChatId === id ? "ok" : "ignore";
  if (!isStart) return "ignore";
  // updateMany with "still null" so two racing /start messages can't both claim the bot
  const res = await prisma.settings.updateMany({ where: { id: 1, telegramChatId: null }, data: { telegramChatId: id } });
  return res.count === 1 ? "linked" : "ignore";
}

async function logIncoming(text: string, chatMessageId: number | undefined): Promise<void> {
  await prisma.telegramMessage.create({ data: { direction: "in", text, chatMessageId: chatMessageId ?? null } });
}

export function defaultTelegramDeps(): TelegramDeps {
  return {
    client: getTelegramClient(),
    enqueue: async (...a) => (await import("../queue/index.js")).enqueue(...a),
    tailorForJob: async (...a) => (await import("../tailor/index.js")).tailorForJob(...a),
    renderResumePdf: async (...a) => (await import("../pdf/index.js")).renderResumePdf(...a),
    submitRawAnswer: async (...a) => (await import("../answers/index.js")).submitRawAnswer(...a),
    approveAnswer: async (...a) => (await import("../answers/index.js")).approveAnswer(...a),
    syncLoopSchedules: async () => (await import("../queue/index.js")).syncLoopSchedules(),
  };
}

let running: Bot | null = null;

// Long polling. No token = the bot simply doesn't start (the client becomes a no-op logger).
export async function startBot(deps: TelegramDeps = defaultTelegramDeps()): Promise<Bot | null> {
  const bot = getBot();
  if (!bot) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN not configured, skipping bot");
    return null;
  }
  if (running) return running;

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    const command = text.startsWith("/") ? text.slice(1).split(/[\s@]/, 1)[0].toLowerCase() : null;
    const auth = await authorizeChat(ctx.chat.id, command === "start");
    if (auth === "ignore") return;
    await logIncoming(text, ctx.message.message_id);
    if (auth === "linked") {
      await ctx.reply("Linked. I'll send job cards here. Commands: /status /pending /pause /resume");
      return;
    }
    if (command === "start") {
      await ctx.reply("Already linked. Commands: /status /pending /pause /resume");
      return;
    }
    if (command) {
      await ctx.reply(await handleCommand(deps, command, text.replace(/^\/\S+\s*/, "")));
      return;
    }
    await handleText(deps, text, ctx.message.reply_to_message?.message_id);
  });

  bot.on("callback_query:data", async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.from.id;
    if ((await authorizeChat(chatId, false)) !== "ok") {
      await ctx.answerCallbackQuery(); // silent
      return;
    }
    const outcome = await handleCallback(deps, ctx.callbackQuery.data);
    await ctx.answerCallbackQuery({ text: outcome.toast }).catch(() => {});
    if (outcome.clearButtons) await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
  });

  bot.catch((err) => console.error("[telegram] handler error:", err.error));

  // Not awaited: start() resolves only when the bot stops.
  void bot.start({ onStart: (me) => console.info(`[telegram] bot @${me.username} started (long polling)`) }).catch((err) => {
    console.error("[telegram] polling stopped:", err);
    running = null;
  });
  running = bot;
  return bot;
}

export async function stopBot(): Promise<void> {
  if (running) {
    await running.stop();
    running = null;
  }
}
