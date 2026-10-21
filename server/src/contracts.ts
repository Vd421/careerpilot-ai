// Shared contracts for the whole app: statuses, API shapes, and the interfaces
// between modules. Owned by the lead. Teammates code against this file and ask
// the lead to change it, never edit it themselves.
//
// No imports on purpose: web/ imports this file too (via the @contracts alias).

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

// A Job's stage BEFORE it becomes an Application.
export const JOB_STAGES = ["discovered", "scored", "filtered_out", "pushed"] as const;
export type JobStage = (typeof JOB_STAGES)[number];

// The status flow from CLAUDE.md. An Application is created when a job is pushed to Telegram.
export const APPLICATION_STATUSES = [
  "pending_approval", // card sent, waiting for [Apply]/[Skip]
  "skipped",
  "needs_answers", // [Apply] tapped, some form questions have no approved answer yet
  "approved", // all answers ready; filled in DRY_RUN or waiting for [Submit]
  "applied",
  "manual", // can't auto-apply: I get link + PDF + answers
  "replied",
  "interview",
  "rejected",
  "offer",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  pending_approval: ["skipped", "needs_answers", "approved", "manual"],
  skipped: ["pending_approval"],
  needs_answers: ["approved", "manual", "skipped"],
  approved: ["applied", "manual", "needs_answers", "skipped"],
  applied: ["replied", "rejected", "interview"],
  manual: ["applied", "skipped"],
  replied: ["interview", "rejected", "offer"],
  interview: ["rejected", "offer"],
  rejected: [],
  offer: [],
};

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return APPLICATION_TRANSITIONS[from].includes(to);
}

// What the dashboard shows in a single "Status" column.
export type DisplayStatus = JobStage | ApplicationStatus;

export type ApplyMethod = "auto" | "manual";
export type ManualReason =
  | "captcha"
  | "unknown_form"
  | "unsupported_platform"
  | "unanswered"
  | "daily_cap"
  | "error";

export const QUESTION_STATUSES = ["pending", "asked", "answered"] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];
export type AskedVia = "bank" | "telegram" | "dashboard";
export type FieldType = "text" | "textarea" | "select" | "radio" | "checkbox" | "file";

// ---------------------------------------------------------------------------
// Sources and platforms
// ---------------------------------------------------------------------------

export const SOURCE_IDS = [
  "manual", // pasted JD / URL
  "jsearch",
  "adzuna",
  "remotive",
  "remoteok",
  "himalayas",
  "arbeitnow",
  "weworkremotely",
  "greenhouse",
  "lever",
  "ashby",
] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export const APPLY_PLATFORMS = ["greenhouse", "lever", "ashby", "other"] as const;
export type ApplyPlatform = (typeof APPLY_PLATFORMS)[number];

// Only these are ever auto-filled. Everything else (Indeed, LinkedIn, Naukri, Workday...) is manual.
export const AUTO_APPLY_PLATFORMS: readonly ApplyPlatform[] = ["greenhouse", "lever", "ashby"];

// Static facts about a source, recorded from its ToS (see docs/DECISIONS.md).
export interface SourceMeta {
  id: SourceId;
  label: string;
  minIntervalMinutes: number; // never fetch the same query more often than this
  attribution: string | null; // text/link the UI must show for jobs from this source
  needsKey: string | null; // env var name, or null
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

export const AGENT_ACTION_TYPES = [
  "job.discovered",
  "job.deduped",
  "job.scored",
  "job.filtered_out",
  "job.pushed",
  "resume.tailored",
  "resume.tailor_rejected", // validation caught an invented bullet/number
  "resume.pdf_rendered",
  "resume.refined", // Refine chat produced a new version
  "resume.refine_rejected", // the validator rejected a refine (would have invented something)
  "resume.restored", // an older version was made current again
  "telegram.card_sent",
  "telegram.tap",
  "application.approved",
  "application.skipped",
  "application.manual",
  "application.marked_applied", // I applied myself on the manual path (dashboard button)
  "form.prescanned",
  "question.matched_bank",
  "question.asked",
  "question.answered",
  "answer.polished",
  "answer.approved",
  "apply.filled",
  "apply.dry_run",
  "apply.submit_approved",
  "apply.submitted",
  "apply.failed",
  "apply.blocked_cap",
  "loop.run_started",
  "loop.run_finished",
  "loop.paused",
  "loop.resumed",
  "settings.updated",
] as const;
export type AgentActionType = (typeof AGENT_ACTION_TYPES)[number];

// ---------------------------------------------------------------------------
// Scoring red flags (extends the existing scoring schema)
// ---------------------------------------------------------------------------

export type RedFlagType = "seniority" | "location" | "visa" | "notice" | "salary" | "other";
export interface RedFlag {
  type: RedFlagType;
  detail: string;
}

// ---------------------------------------------------------------------------
// Tailoring (output of the better model, checked in code)
// ---------------------------------------------------------------------------

// Every rewritten bullet points to exactly one real bullet id in resume.json.
// Validation rules (server/src/tailor/validate.ts):
//  1. sourceBulletId exists and belongs to the parent sourceId
//  2. no bullet id used twice
//  3. every number in `text` appears in the source bullet text
//  4. every skill in skillsOrder exists in resume.skills
export interface TailoredBullet {
  sourceBulletId: string;
  text: string;
}
export interface TailoredSection {
  sourceId: string; // experience or project id
  bullets: TailoredBullet[];
}
export interface TailoredResume {
  headline: string | null; // a one-line summary built only from resume facts
  sections: TailoredSection[];
  skillsOrder: string[];
  coverNote: string | null;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface SalaryFloors {
  [currency: string]: number; // yearly minimum in that currency, e.g. { INR: 1200000, USD: 30000 }
}

export interface FilterSettings {
  salaryFloors: SalaryFloors;
  noticeDays: number;
  matchThreshold: number;
  maxYearsRequired: number;
}

// Per-Loop overrides; anything missing falls back to Settings.
export interface LoopFilters {
  minScore?: number;
  salaryFloors?: SalaryFloors;
  remoteOnly?: boolean;
  excludeKeywords?: string[]; // e.g. ["senior", "staff", "lead"]
  locations?: string[]; // filled from Loop.locations by the pipeline, not stored in filters JSON
}

export interface FilterResult {
  keep: boolean;
  tags: string[]; // e.g. ["salary_unknown"]
  reasons: string[]; // why dropped, human-readable
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export interface SourceQuery {
  keywords: string[];
  locations: string[]; // "Remote", "India", "Bengaluru", ...
}

// What every adapter returns. Salary normalized to yearly if the source says hourly/monthly.
export interface RawJob {
  source: SourceId;
  externalId: string;
  company: string;
  title: string;
  url: string;
  description: string; // plain text, HTML stripped
  location: string | null;
  remote: boolean | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  postedAt: string | null; // ISO
  applyPlatform: ApplyPlatform;
}

export interface JobSource {
  meta: SourceMeta;
  fetch(query: SourceQuery, http?: HttpGet): Promise<RawJob[]>;
}

// Injected so adapter tests run on saved fixtures, never the network.
export type HttpGet = (url: string, headers?: Record<string, string>) => Promise<{ status: number; body: string }>;

// ---------------------------------------------------------------------------
// Forms / apply
// ---------------------------------------------------------------------------

export interface FormField {
  name: string; // input name/id the filler will target
  label: string; // the question text
  type: FieldType;
  required: boolean;
  options: string[];
}

export interface PrescanResult {
  ok: boolean;
  fields: FormField[];
  blocker: ManualReason | null; // captcha | unknown_form | unsupported_platform
}

export interface FillRequest {
  url: string;
  platform: ApplyPlatform;
  answers: Record<string, string>; // field name -> value
  resumePdfPath: string;
  submit: boolean; // true only when !dryRun AND submitApprovedAt is set AND lock acquired
}

export interface FillResult {
  ok: boolean;
  submitted: boolean;
  screenshotPath: string | null;
  blocker: ManualReason | null;
  error: string | null;
}

// Playwright lives behind this so tests use a fake.
export interface FormFiller {
  prescan(url: string, platform: ApplyPlatform): Promise<PrescanResult>;
  fill(req: FillRequest): Promise<FillResult>;
}

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

export interface InlineButton {
  text: string;
  data: string; // callback data, see CALLBACK below
}

// Low-level client: grammY in prod, a fake in tests.
export interface TelegramClient {
  sendMessage(text: string, buttons?: InlineButton[][]): Promise<{ messageId: number }>;
  sendPhoto(path: string, caption: string, buttons?: InlineButton[][]): Promise<{ messageId: number }>;
  sendDocument(path: string, caption: string): Promise<{ messageId: number }>;
}

// Callback data format "<action>:<id>". Max 64 bytes (Telegram limit).
export const CALLBACK = {
  apply: (applicationId: number) => `apply:${applicationId}`,
  skip: (applicationId: number) => `skip:${applicationId}`,
  viewResume: (applicationId: number) => `resume:${applicationId}`,
  submit: (applicationId: number) => `submit:${applicationId}`,
  cancel: (applicationId: number) => `cancel:${applicationId}`,
  useAnswer: (questionId: number) => `ans_use:${questionId}`,
  editAnswer: (questionId: number) => `ans_edit:${questionId}`,
  useOriginal: (questionId: number) => `ans_orig:${questionId}`,
} as const;

// ---------------------------------------------------------------------------
// Cross-module entry points (who exports what)
// Implementations must match these signatures exactly.
// ---------------------------------------------------------------------------

// backend: server/src/tailor/index.ts
export type TailorForJob = (jobId: number, variantId?: number) => Promise<{ resumeVersionId: number }>;
// backend: server/src/tailor/index.ts. Never invents: the result goes through the same validator as tailoring.
// resumeVersionId is null when nothing changed or the change was rejected; reply says why.
export type RefineResume = (
  jobId: number,
  message: string,
  baseVersionId: number,
) => Promise<{ reply: string; resumeVersionId: number | null }>;
// backend: server/src/pdf/index.ts
export type RenderResumePdf = (resumeVersionId: number) => Promise<{ pdfPath: string }>;
// backend: server/src/filters/index.ts
export type ApplyFilters = (
  job: Pick<RawJob, "title" | "description" | "location" | "remote" | "salaryMin" | "salaryMax" | "salaryCurrency">,
  settings: FilterSettings,
  loop?: LoopFilters,
) => FilterResult;
// backend: server/src/queue/index.ts
export type Enqueue = (name: QueueName, data: Record<string, unknown>, opts?: { singletonKey?: string }) => Promise<void>;

// integrations: server/src/discovery/index.ts
export type RunDiscovery = (query: SourceQuery, sources: SourceId[]) => Promise<RawJob[]>;
// integrations: server/src/telegram/index.ts
export type SendJobCard = (applicationId: number) => Promise<void>;
// integrations: server/src/apply/index.ts (called by the [Apply] handler and the queue)
export type StartApplication = (applicationId: number) => Promise<void>;
// integrations: server/src/answers/index.ts (called by the API when I answer on the dashboard)
export type SubmitRawAnswer = (questionId: number, rawAnswer: string) => Promise<{ polished: string }>;
export type ApproveAnswer = (
  questionId: number,
  choice: "polished" | "original" | { edited: string },
  reusable: boolean,
) => Promise<void>;

// pg-boss queue names
export const QUEUES = {
  loopRun: "loop.run", // { loopId }
  scoreJob: "job.score", // { jobId }
  pushJob: "job.push", // { jobId }  creates Application + sends card
  tailor: "resume.tailor", // { jobId, variantId? }
  prescan: "apply.prescan", // { applicationId }
  fill: "apply.fill", // { applicationId }
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

// ---------------------------------------------------------------------------
// REST API (all under /api). Dates are ISO strings.
// ---------------------------------------------------------------------------

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiError {
  error: string;
  details?: unknown;
}

// GET /api/status
export interface StatusResponse {
  telegramConnected: boolean;
  appliedToday: number;
  dailyCap: number;
  dryRun: boolean;
}

// GET /api/overview
export interface OverviewResponse {
  stats: { discovered: number; applied: number; awaitingMe: number; replies: number };
  funnel: { stage: string; count: number }[]; // discovered → scored → pushed → approved → applied → replied
  attention: AttentionItem[];
  recentActivity: ActivityItem[];
}
export interface AttentionItem {
  kind: "approval" | "question" | "submit" | "manual";
  id: number; // applicationId or questionId
  title: string;
  subtitle: string;
  createdAt: string;
}

// GET /api/jobs?stage=&status=&loopId=&source=&q=&page=&pageSize=   → Paginated<JobListItem>
// GET /api/jobs/recent                                              → JobListItem[] (10)
export interface JobListItem {
  id: number;
  company: string;
  title: string;
  source: SourceId;
  url: string | null;
  location: string | null;
  remote: boolean | null;
  matchScore: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  redFlags: RedFlag[];
  tags: string[];
  status: DisplayStatus; // application status if one exists, else job stage
  applicationId: number | null;
  loopId: number | null;
  createdAt: string;
}

// GET /api/jobs/:id
export interface JobDetail extends JobListItem {
  description: string;
  summary: string | null;
  matchedSkills: string[];
  missingSkills: string[];
  filterReasons: string[];
  applyPlatform: ApplyPlatform;
  attribution: string | null;
  resumeVersions: ResumeVersionItem[];
  application: ApplicationListItem | null;
}

// POST /api/jobs  (paste)  → JobDetail; scoring runs in the background
export interface CreateJobRequest {
  url?: string;
  description?: string; // required if url is not a known board URL
  company?: string;
  title?: string;
}
// POST /api/jobs/:id/push   → { applicationId }   send card to Telegram
// POST /api/jobs/:id/tailor → ResumeVersionItem
// POST /api/jobs/:id/skip   → 204

export interface ResumeVersionItem {
  id: number;
  variantName: string | null;
  tailored: TailoredResume;
  pdfUrl: string | null; // /api/resume-versions/:id/pdf
  createdAt: string;
  parentId: number | null; // the version it was refined/restored from
  instruction: string | null; // the Refine chat message that produced it
  active: boolean; // the one an application would use (application's version, else the newest)
}

// GET  /api/jobs/:id/resume-chat                          → ResumeChatMessageItem[]
// POST /api/jobs/:id/resume-chat  RefineRequest           → RefineResponse
//   400 if no tailored version yet, 409 once the application was submitted
// POST /api/resume-versions/:id/restore                   → ResumeVersionItem (copy made current, no AI cost)
export interface ResumeChatMessageItem {
  id: number;
  role: "user" | "assistant";
  text: string;
  resumeVersionId: number | null;
  createdAt: string;
}
export interface RefineRequest {
  message: string; // 1..1000 chars
  baseVersionId?: number; // default: the active version
}
export interface RefineResponse {
  messages: ResumeChatMessageItem[]; // the new user + assistant messages
  version: ResumeVersionItem | null; // the new version, if one was made
}

// GET /api/applications?status=&loopId=   → ApplicationListItem[]
// GET /api/applications/:id                → ApplicationDetail
// POST /api/applications/:id/mark-applied  → 204 (manual path: I applied myself)
export interface ApplicationListItem {
  id: number;
  jobId: number;
  company: string;
  title: string;
  status: ApplicationStatus;
  method: ApplyMethod | null;
  resumeVersionId: number | null;
  variantName: string | null;
  appliedAt: string | null;
  screenshotUrl: string | null; // /api/screenshots/:file
  manualReason: ManualReason | null;
  applyUrl: string | null;
  createdAt: string;
}
export interface ApplicationDetail extends ApplicationListItem {
  pdfUrl: string | null;
  questions: QuestionItem[]; // with answers, copyable for manual apply
}

// GET  /api/questions?status=pending|asked|answered   → QuestionItem[]
// POST /api/questions/:id/answer  { rawAnswer }       → { polished }
// POST /api/questions/:id/approve { choice, edited?, reusable } → 204
export interface QuestionItem {
  id: number;
  applicationId: number;
  company: string;
  jobTitle: string;
  text: string;
  fieldType: FieldType;
  options: string[];
  required: boolean;
  status: QuestionStatus;
  askedVia: AskedVia | null;
  answer: AnswerItem | null;
  createdAt: string;
}
export interface ApproveAnswerRequest {
  choice: "polished" | "original" | "edited";
  edited?: string;
  reusable: boolean;
}

// GET /api/answers → AnswerItem[];  PATCH /api/answers/:id (partial);  DELETE /api/answers/:id
export interface AnswerItem {
  id: number;
  key: string | null;
  questionText: string;
  rawAnswer: string;
  polishedAnswer: string | null;
  approved: boolean;
  reusable: boolean;
  tags: string[];
  updatedAt: string;
}

// GET /api/activity?type=&jobId=&applicationId=&loopId=&before=<id>&limit=  → ActivityItem[]
export interface ActivityItem {
  id: number;
  type: AgentActionType;
  jobId: number | null;
  applicationId: number | null;
  loopId: number | null;
  jobLabel: string | null; // "Company · Title"
  detail: Record<string, unknown>;
  createdAt: string;
}

// GET /api/loops → LoopItem[];  POST /api/loops (LoopInput) → LoopItem
// GET /api/loops/:id → LoopDetail;  PATCH /api/loops/:id (Partial<LoopInput>)
// POST /api/loops/:id/pause | /resume | /run → LoopItem
export interface LoopInput {
  name: string;
  keywords: string[];
  locations: string[];
  sources: SourceId[];
  filters: LoopFilters;
  resumeVariantIds: number[]; // 0, 1 or 2
  schedule: string; // cron, default "0 */6 * * *"
}
export interface LoopStats {
  found: number;
  approved: number;
  applied: number;
  replied: number;
  responseRate: number; // replied / applied, 0..1
}
export interface LoopItem extends LoopInput {
  id: number;
  active: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  stats: LoopStats;
}
export interface VariantStats extends LoopStats {
  variantId: number;
  variantName: string;
}
export interface LoopDetail extends LoopItem {
  variants: VariantStats[];
}

// GET /api/resume-variants → ResumeVariantItem[]
export interface ResumeVariantItem {
  id: number;
  name: string;
  filePath: string;
}

// GET /api/sources → SourceStatus[]
export interface SourceStatus extends SourceMeta {
  enabled: boolean;
  configured: boolean; // key present (or none needed)
}

// GET /api/settings → SettingsDto;  PUT /api/settings (Partial<SettingsDto>) → SettingsDto
export interface SettingsDto extends FilterSettings {
  sources: Partial<Record<SourceId, boolean>>;
  dailyCap: number; // max 15
  maxScoresPerDay: number;
  maxTailorsPerDay: number;
  dryRun: boolean;
  telegramLinked: boolean;
}

export const HARD_DAILY_CAP = 15;
