import { join } from "node:path";
import type {
  ApproveAnswer,
  Enqueue,
  RawJob,
  RefineResume,
  RenderResumePdf,
  SubmitRawAnswer,
  TailorForJob,
} from "../contracts.js";
import { prisma } from "../db.js";
import { PRIVATE_DIR } from "../tailor/paths.js";

// Everything the API calls outside its own folder. Tests pass fakes, so no route touches
// pg-boss, Claude, Telegram or a browser in tests.
export interface ApiDeps {
  enqueue: Enqueue;
  syncLoopSchedules: () => Promise<void>;
  fetchJobFromUrl: (url: string) => Promise<RawJob | null>;
  tailorForJob: TailorForJob;
  refineResume: RefineResume;
  renderResumePdf: RenderResumePdf;
  submitRawAnswer: SubmitRawAnswer;
  approveAnswer: ApproveAnswer;
  isTelegramConnected: () => Promise<boolean>;
  screenshotsDir: string;
}

// Lazy imports: loading the API doesn't pull in pg-boss, Playwright or grammY until a route needs them.
// The specifier for answers/ is a variable so this file compiles even before that module exists.
const answersModule = "../answers/index.js";

export const defaultDeps: ApiDeps = {
  enqueue: async (...args) => (await import("../queue/index.js")).enqueue(...args),
  syncLoopSchedules: async () => (await import("../queue/index.js")).syncLoopSchedules(),
  fetchJobFromUrl: async (url) => (await import("../discovery/fromUrl.js")).fetchJobFromUrl(url),
  tailorForJob: async (...args) => (await import("../tailor/index.js")).tailorForJob(...args),
  refineResume: async (...args) => (await import("../tailor/index.js")).refineResume(...args),
  renderResumePdf: async (...args) => (await import("../pdf/index.js")).renderResumePdf(...args),
  submitRawAnswer: async (...args) => (await import(answersModule)).submitRawAnswer(...args),
  approveAnswer: async (...args) => (await import(answersModule)).approveAnswer(...args),
  isTelegramConnected: async () => {
    if (!process.env.TELEGRAM_BOT_TOKEN) return false;
    const s = await prisma.settings.findUnique({ where: { id: 1 } });
    return Boolean(s?.telegramChatId);
  },
  screenshotsDir: join(PRIVATE_DIR, "screenshots"),
};
