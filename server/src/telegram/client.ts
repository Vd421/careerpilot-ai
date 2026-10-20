import { Bot, InputFile } from "grammy";
import type { InlineButton } from "../contracts.js";
import { prisma } from "../db.js";
import type { MessageContext, RawTelegram, TelegramSender } from "./types.js";

// Telegram's hard limit is 4096 characters per message, 1024 per caption.
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const keyboard = (buttons?: InlineButton[][]) =>
  buttons?.length
    ? { reply_markup: { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) } }
    : {};

export function grammyRaw(bot: Bot): RawTelegram {
  return {
    async sendMessage(chatId, text, buttons) {
      return (await bot.api.sendMessage(chatId, clip(text, 4000), keyboard(buttons))).message_id;
    },
    async sendPhoto(chatId, path, caption, buttons) {
      return (await bot.api.sendPhoto(chatId, new InputFile(path), { caption: clip(caption, 1000), ...keyboard(buttons) })).message_id;
    },
    async sendDocument(chatId, path, caption) {
      return (await bot.api.sendDocument(chatId, new InputFile(path), { caption: clip(caption, 1000) })).message_id;
    },
  };
}

// Sends to the chat saved in Settings and saves every outgoing message as TelegramMessage(out).
// No chat linked yet (I never sent /start) -> warn and drop, never crash.
export function createTelegramClient(raw: RawTelegram): TelegramSender {
  async function chatId(): Promise<string | null> {
    const s = await prisma.settings.findUnique({ where: { id: 1 } });
    return s?.telegramChatId ?? null;
  }
  async function save(text: string, messageId: number, ctx?: MessageContext) {
    await prisma.telegramMessage.create({
      data: {
        direction: "out",
        text,
        chatMessageId: messageId,
        applicationId: ctx?.applicationId ?? null,
        questionId: ctx?.questionId ?? null,
      },
    });
  }
  async function unlinked(): Promise<{ messageId: number }> {
    console.warn("[telegram] no chat linked yet (send /start to the bot), message dropped");
    return { messageId: 0 };
  }

  return {
    async sendMessage(text, buttons, ctx) {
      const id = await chatId();
      if (!id) return unlinked();
      const messageId = await raw.sendMessage(id, text, buttons);
      await save(text, messageId, ctx);
      return { messageId };
    },
    async sendPhoto(path, caption, buttons, ctx) {
      const id = await chatId();
      if (!id) return unlinked();
      const messageId = await raw.sendPhoto(id, path, caption, buttons);
      await save(`[photo] ${caption}`, messageId, ctx);
      return { messageId };
    },
    async sendDocument(path, caption, ctx) {
      const id = await chatId();
      if (!id) return unlinked();
      const messageId = await raw.sendDocument(id, path, caption);
      await save(`[document] ${caption}`, messageId, ctx);
      return { messageId };
    },
  };
}

// Used when TELEGRAM_BOT_TOKEN is missing: everything is logged instead of sent.
export const noopClient: TelegramSender = {
  async sendMessage(text) {
    console.info(`[telegram:noop] ${text.split("\n")[0]}`);
    return { messageId: 0 };
  },
  async sendPhoto(_path, caption) {
    console.info(`[telegram:noop] photo: ${caption.split("\n")[0]}`);
    return { messageId: 0 };
  },
  async sendDocument(_path, caption) {
    console.info(`[telegram:noop] document: ${caption.split("\n")[0]}`);
    return { messageId: 0 };
  },
};

let bot: Bot | null = null;
let client: TelegramSender | null = null;

export function getBot(): Bot | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  bot ??= new Bot(token);
  return bot;
}

// Real client when a token exists, otherwise the no-op logger. Tests call setTelegramClient with a fake.
export function getTelegramClient(): TelegramSender {
  if (client) return client;
  const b = getBot();
  client = b ? createTelegramClient(grammyRaw(b)) : noopClient;
  return client;
}

export function setTelegramClient(c: TelegramSender | null): void {
  client = c;
}
