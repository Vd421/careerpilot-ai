import type { Enqueue, FillRequest, FormFiller, RenderResumePdf, TailorForJob } from "../contracts.js";
import type { ClassifierModel } from "../answers/match.js";
import type { Resume } from "../resume/schema.js";
import type { TelegramSender } from "../telegram/types.js";

// The contract's FillRequest plus where to save the screenshot (the filler doesn't know the application id).
export interface FillRequestX extends FillRequest {
  screenshotPath?: string; // absolute
}

export interface FormFillerX extends FormFiller {
  fill(req: FillRequestX): ReturnType<FormFiller["fill"]>;
}

// Everything startApplication / fillApplication need from outside. Tests pass fakes (no browser, no Telegram, no Claude).
export interface ApplyDeps {
  filler: FormFillerX;
  telegram: TelegramSender;
  askQuestion: (questionId: number) => Promise<void>;
  tailorForJob: TailorForJob;
  renderResumePdf: RenderResumePdf;
  enqueue: Enqueue;
  loadResume: (variantId: number | null) => Promise<Resume> | Resume;
  classifier?: ClassifierModel; // answer-bank classifier; undefined = real one when a key exists
  screenshotsDir: string; // absolute
  now?: () => Date;
}
