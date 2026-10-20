import { basename } from "node:path";
import { CronExpressionParser } from "cron-parser";
import type {
  ActivityItem,
  AgentActionType,
  AnswerItem,
  ApplicationDetail,
  ApplicationListItem,
  ApplicationStatus,
  ApplyMethod,
  ApplyPlatform,
  FieldType,
  JobDetail,
  JobListItem,
  JobStage,
  LoopFilters,
  LoopItem,
  LoopStats,
  ManualReason,
  QuestionItem,
  QuestionStatus,
  RedFlag,
  ResumeVersionItem,
  SettingsDto,
  SourceId,
  TailoredResume,
  AskedVia,
} from "../contracts.js";
import { HARD_DAILY_CAP } from "../contracts.js";
import { SOURCE_META } from "../discovery/meta.js";
import type { Prisma } from "../generated/prisma/client.js";

// One place that turns DB rows into the DTOs in contracts.ts.

// ---- includes (what each mapper needs loaded) ----
export const jobListInclude = { application: true } satisfies Prisma.JobInclude;
export const applicationInclude = {
  job: true,
  resumeVariant: true,
  resumeVersion: { include: { variant: true } },
} satisfies Prisma.ApplicationInclude;
export const jobDetailInclude = {
  application: { include: applicationInclude },
  resumeVersions: { include: { variant: true }, orderBy: { createdAt: "desc" } },
} satisfies Prisma.JobInclude;
export const questionInclude = {
  answer: true,
  application: { include: { job: true } },
} satisfies Prisma.QuestionInclude;
export const activityInclude = { job: true } satisfies Prisma.AgentActionInclude;

type JobListRow = Prisma.JobGetPayload<{ include: typeof jobListInclude }>;
type JobDetailRow = Prisma.JobGetPayload<{ include: typeof jobDetailInclude }>;
type ApplicationRow = Prisma.ApplicationGetPayload<{ include: typeof applicationInclude }>;
type VersionRow = Prisma.ResumeVersionGetPayload<{ include: { variant: true } }>;
type QuestionRow = Prisma.QuestionGetPayload<{ include: typeof questionInclude }>;
type ActivityRow = Prisma.AgentActionGetPayload<{ include: typeof activityInclude }>;
type LoopRow = Prisma.LoopGetPayload<object>;
type AnswerRow = Prisma.AnswerGetPayload<object>;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toRedFlags(json: unknown): RedFlag[] {
  if (!Array.isArray(json)) return [];
  return json.filter(
    (f): f is RedFlag => !!f && typeof f === "object" && typeof f.type === "string" && typeof f.detail === "string",
  );
}

export function toJobListItem(j: JobListRow): JobListItem {
  return {
    id: j.id,
    company: j.company,
    title: j.title,
    source: j.source as SourceId,
    url: j.url,
    location: j.location,
    remote: j.remote,
    matchScore: j.matchScore,
    salaryMin: j.salaryMin,
    salaryMax: j.salaryMax,
    salaryCurrency: j.salaryCurrency,
    redFlags: toRedFlags(j.redFlags),
    tags: j.tags,
    status: (j.application?.status as ApplicationStatus | undefined) ?? (j.stage as JobStage),
    applicationId: j.application?.id ?? null,
    loopId: j.loopId,
    createdAt: j.createdAt.toISOString(),
  };
}

export function toResumeVersionItem(v: VersionRow): ResumeVersionItem {
  return {
    id: v.id,
    variantName: v.variant?.name ?? null,
    tailored: v.tailored as unknown as TailoredResume,
    pdfUrl: v.pdfPath ? `/api/resume-versions/${v.id}/pdf` : null,
    createdAt: v.createdAt.toISOString(),
  };
}

export function toApplicationListItem(a: ApplicationRow): ApplicationListItem {
  return {
    id: a.id,
    jobId: a.jobId,
    company: a.job.company,
    title: a.job.title,
    status: a.status as ApplicationStatus,
    method: a.method as ApplyMethod | null,
    resumeVersionId: a.resumeVersionId,
    variantName: a.resumeVersion?.variant?.name ?? a.resumeVariant?.name ?? null,
    appliedAt: iso(a.appliedAt),
    screenshotUrl: a.screenshotPath ? `/api/screenshots/${encodeURIComponent(basename(a.screenshotPath))}` : null,
    manualReason: a.manualReason as ManualReason | null,
    applyUrl: a.job.url,
    createdAt: a.createdAt.toISOString(),
  };
}

export function toApplicationDetail(a: ApplicationRow, questions: QuestionRow[]): ApplicationDetail {
  return {
    ...toApplicationListItem(a),
    pdfUrl: a.resumeVersion?.pdfPath ? `/api/resume-versions/${a.resumeVersion.id}/pdf` : null,
    questions: questions.map(toQuestionItem),
  };
}

export function toJobDetail(j: JobDetailRow): JobDetail {
  return {
    ...toJobListItem(j),
    description: j.description,
    summary: j.summary,
    matchedSkills: j.matchedSkills,
    missingSkills: j.missingSkills,
    filterReasons: j.filterReasons,
    applyPlatform: j.applyPlatform as ApplyPlatform,
    attribution: SOURCE_META[j.source as SourceId]?.attribution ?? null,
    resumeVersions: j.resumeVersions.map(toResumeVersionItem),
    application: j.application ? toApplicationListItem(j.application) : null,
  };
}

export function toAnswerItem(a: AnswerRow): AnswerItem {
  return {
    id: a.id,
    key: a.key,
    questionText: a.questionText,
    rawAnswer: a.rawAnswer,
    polishedAnswer: a.polishedAnswer,
    approved: a.approved,
    reusable: a.reusable,
    tags: a.tags,
    updatedAt: a.updatedAt.toISOString(),
  };
}

export function toQuestionItem(q: QuestionRow): QuestionItem {
  return {
    id: q.id,
    applicationId: q.applicationId,
    company: q.application.job.company,
    jobTitle: q.application.job.title,
    text: q.text,
    fieldType: q.fieldType as FieldType,
    options: q.options,
    required: q.required,
    status: q.status as QuestionStatus,
    askedVia: q.askedVia as AskedVia | null,
    answer: q.answer ? toAnswerItem(q.answer) : null,
    createdAt: q.createdAt.toISOString(),
  };
}

export function toActivityItem(a: ActivityRow): ActivityItem {
  return {
    id: a.id,
    type: a.type as AgentActionType,
    jobId: a.jobId,
    applicationId: a.applicationId,
    loopId: a.loopId,
    jobLabel: a.job ? `${a.job.company} · ${a.job.title}` : null,
    detail: (a.detail && typeof a.detail === "object" && !Array.isArray(a.detail) ? a.detail : {}) as Record<
      string,
      unknown
    >,
    createdAt: a.createdAt.toISOString(),
  };
}

// ---- loops ----
export function nextRunAt(cron: string, active: boolean): string | null {
  if (!active) return null;
  try {
    return CronExpressionParser.parse(cron).next().toDate().toISOString();
  } catch {
    return null;
  }
}

export function isValidCron(cron: string): boolean {
  try {
    CronExpressionParser.parse(cron);
    return true;
  } catch {
    return false;
  }
}

const APPLIED = new Set(["applied", "replied", "interview", "rejected", "offer"]);
const REPLIED = new Set(["replied", "interview", "offer"]);

// found = jobs with the loop; approved = tapped [Apply]; applied/replied by status; responseRate = replied / applied
export function computeStats(found: number, apps: { status: string; approvedAt: Date | null }[]): LoopStats {
  const applied = apps.filter((a) => APPLIED.has(a.status)).length;
  const replied = apps.filter((a) => REPLIED.has(a.status)).length;
  return {
    found,
    approved: apps.filter((a) => a.approvedAt !== null).length,
    applied,
    replied,
    responseRate: applied === 0 ? 0 : replied / applied,
  };
}

export function toLoopItem(l: LoopRow, stats: LoopStats): LoopItem {
  return {
    id: l.id,
    name: l.name,
    keywords: l.keywords,
    locations: l.locations,
    sources: l.sources as SourceId[],
    filters: (l.filters ?? {}) as LoopFilters,
    resumeVariantIds: l.resumeVariantIds,
    schedule: l.schedule,
    active: l.active,
    lastRunAt: iso(l.lastRunAt),
    nextRunAt: nextRunAt(l.schedule, l.active),
    stats,
  };
}

// ---- settings ----
export function toSettingsDto(s: Prisma.SettingsGetPayload<object>): SettingsDto {
  return {
    salaryFloors: (s.salaryFloors ?? {}) as Record<string, number>,
    noticeDays: s.noticeDays,
    matchThreshold: s.matchThreshold,
    maxYearsRequired: s.maxYearsRequired,
    sources: (s.sources ?? {}) as SettingsDto["sources"],
    dailyCap: Math.min(s.dailyCap, HARD_DAILY_CAP),
    maxScoresPerDay: s.maxScoresPerDay,
    maxTailorsPerDay: s.maxTailorsPerDay,
    dryRun: s.dryRun,
    telegramLinked: s.telegramChatId !== null,
  };
}
