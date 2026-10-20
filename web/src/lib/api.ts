// One function per route in contracts.ts. In mock mode (VITE_MOCK=1) the same
// calls are answered by src/mocks/router.ts, so no page knows which mode it is in.
import type {
  ActivityItem,
  AgentActionType,
  AnswerItem,
  ApiError,
  ApplicationDetail,
  ApplicationListItem,
  ApplicationStatus,
  ApproveAnswerRequest,
  CreateJobRequest,
  JobDetail,
  JobListItem,
  LoopDetail,
  LoopInput,
  LoopItem,
  OverviewResponse,
  Paginated,
  QuestionItem,
  QuestionStatus,
  ResumeVariantItem,
  ResumeVersionItem,
  SettingsDto,
  SourceStatus,
  StatusResponse,
} from "@contracts";

export const MOCK = import.meta.env.VITE_MOCK === "1";

export class ApiRequestError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, body: ApiError) {
    super(body.error);
    this.status = status;
    this.details = body.details;
  }
}

type Query = Record<string, string | number | undefined | null>;

function qs(q?: Query) {
  if (!q) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function request<T>(method: string, path: string, opts: { query?: Query; body?: unknown } = {}): Promise<T> {
  if (MOCK) {
    const { mockRequest } = await import("../mocks/router");
    return mockRequest<T>(method, path, opts.query ?? {}, opts.body);
  }
  const res = await fetch(`/api${path}${qs(opts.query)}`, {
    method,
    headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new ApiRequestError(res.status, data as ApiError);
  return data as T;
}

const get = <T>(path: string, query?: Query) => request<T>("GET", path, { query });
const post = <T>(path: string, body?: unknown) => request<T>("POST", path, { body });

export interface JobsQuery {
  stage?: string;
  status?: string;
  loopId?: number;
  source?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export const api = {
  status: () => get<StatusResponse>("/status"),
  overview: () => get<OverviewResponse>("/overview"),

  jobs: (q: JobsQuery = {}) => get<Paginated<JobListItem>>("/jobs", q as Query),
  recentJobs: () => get<JobListItem[]>("/jobs/recent"),
  job: (id: number) => get<JobDetail>(`/jobs/${id}`),
  createJob: (body: CreateJobRequest) => post<JobDetail>("/jobs", body),
  pushJob: (id: number) => post<{ applicationId: number }>(`/jobs/${id}/push`),
  tailorJob: (id: number) => post<ResumeVersionItem>(`/jobs/${id}/tailor`),
  skipJob: (id: number) => post<void>(`/jobs/${id}/skip`),

  applications: (q: { status?: ApplicationStatus; loopId?: number } = {}) =>
    get<ApplicationListItem[]>("/applications", q as Query),
  application: (id: number) => get<ApplicationDetail>(`/applications/${id}`),
  markApplied: (id: number) => post<void>(`/applications/${id}/mark-applied`),

  questions: (status?: QuestionStatus) => get<QuestionItem[]>("/questions", { status }),
  answerQuestion: (id: number, rawAnswer: string) =>
    post<{ polished: string }>(`/questions/${id}/answer`, { rawAnswer }),
  approveQuestion: (id: number, body: ApproveAnswerRequest) => post<void>(`/questions/${id}/approve`, body),

  answers: () => get<AnswerItem[]>("/answers"),
  updateAnswer: (id: number, patch: Partial<AnswerItem>) =>
    request<AnswerItem>("PATCH", `/answers/${id}`, { body: patch }),
  deleteAnswer: (id: number) => request<void>("DELETE", `/answers/${id}`),

  activity: (
    q: { type?: AgentActionType; jobId?: number; applicationId?: number; loopId?: number; before?: number; limit?: number } = {},
  ) => get<ActivityItem[]>("/activity", q as Query),

  loops: () => get<LoopItem[]>("/loops"),
  loop: (id: number) => get<LoopDetail>(`/loops/${id}`),
  createLoop: (body: LoopInput) => post<LoopItem>("/loops", body),
  updateLoop: (id: number, patch: Partial<LoopInput>) => request<LoopItem>("PATCH", `/loops/${id}`, { body: patch }),
  pauseLoop: (id: number) => post<LoopItem>(`/loops/${id}/pause`),
  resumeLoop: (id: number) => post<LoopItem>(`/loops/${id}/resume`),
  runLoop: (id: number) => post<LoopItem>(`/loops/${id}/run`),

  resumeVariants: () => get<ResumeVariantItem[]>("/resume-variants"),
  sources: () => get<SourceStatus[]>("/sources"),
  settings: () => get<SettingsDto>("/settings"),
  updateSettings: (patch: Partial<SettingsDto>) => request<SettingsDto>("PUT", "/settings", { body: patch }),
};

/** Screenshot and PDF URLs come from the API; in mock mode screenshots are drawn locally. */
export async function resolveScreenshot(url: string): Promise<string> {
  if (!MOCK) return url;
  const { mockScreenshot } = await import("../mocks/screenshot");
  return mockScreenshot(url);
}
