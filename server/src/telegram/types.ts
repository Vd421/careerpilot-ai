import type {
  ApproveAnswer,
  Enqueue,
  InlineButton,
  RenderResumePdf,
  SubmitRawAnswer,
  TailorForJob,
} from "../contracts.js";

// Which application / question a message is about, so replies can be routed later.
export interface MessageContext {
  applicationId?: number;
  questionId?: number;
}

// The contract's TelegramClient plus an optional context argument (still assignable to the contract type).
export interface TelegramSender {
  sendMessage(text: string, buttons?: InlineButton[][], ctx?: MessageContext): Promise<{ messageId: number }>;
  sendPhoto(path: string, caption: string, buttons?: InlineButton[][], ctx?: MessageContext): Promise<{ messageId: number }>;
  sendDocument(path: string, caption: string, ctx?: MessageContext): Promise<{ messageId: number }>;
}

// Low level: only talks to Telegram, knows nothing about our DB. grammY in prod, a fake in tests.
export interface RawTelegram {
  sendMessage(chatId: string, text: string, buttons?: InlineButton[][]): Promise<number>;
  sendPhoto(chatId: string, path: string, caption: string, buttons?: InlineButton[][]): Promise<number>;
  sendDocument(chatId: string, path: string, caption: string): Promise<number>;
}

// Everything the handlers need from outside. Tests pass fakes; production wires the real modules lazily.
export interface TelegramDeps {
  client: TelegramSender;
  enqueue: Enqueue;
  tailorForJob: TailorForJob;
  renderResumePdf: RenderResumePdf;
  submitRawAnswer: SubmitRawAnswer;
  approveAnswer: ApproveAnswer;
  syncLoopSchedules: () => Promise<void>;
}
