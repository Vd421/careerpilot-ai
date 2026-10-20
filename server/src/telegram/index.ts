import type { SendJobCard } from "../contracts.js";
import { sendJobCardWith } from "./card.js";
import { getTelegramClient } from "./client.js";
import { askQuestionWith } from "./questions.js";

export { startBot, stopBot, authorizeChat, defaultTelegramDeps } from "./bot.js";
export { getTelegramClient, setTelegramClient, createTelegramClient, noopClient } from "./client.js";
export { handleCallback, handleCommand, handleText, routeReply } from "./handlers.js";
export { sendJobCardWith, formatSalary } from "./card.js";
export { askQuestionWith } from "./questions.js";
export type { TelegramDeps, TelegramSender, RawTelegram, MessageContext } from "./types.js";

// Contract entry points (use the process-wide client: real bot, or the no-op logger without a token).
export const sendJobCard: SendJobCard = (applicationId) => sendJobCardWith(getTelegramClient(), applicationId);
export const askQuestion = (questionId: number) => askQuestionWith(getTelegramClient(), questionId);
