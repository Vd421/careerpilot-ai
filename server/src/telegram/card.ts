import { CALLBACK, type InlineButton, type RedFlag, type SourceId } from "../contracts.js";
import { prisma } from "../db.js";
import { SOURCE_META } from "../discovery/meta.js";
import { logAction } from "./log.js";
import type { TelegramSender } from "./types.js";

const money = (n: number) => n.toLocaleString("en-US");

export function formatSalary(min: number | null, max: number | null, currency: string | null): string | null {
  if (min == null && max == null) return null;
  const range = min != null && max != null && min !== max ? `${money(min)}-${money(max)}` : money((min ?? max) as number);
  return `${currency ?? ""} ${range} / year`.trim();
}

const shorten = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function cardButtons(applicationId: number): InlineButton[][] {
  return [
    [
      { text: "Apply", data: CALLBACK.apply(applicationId) },
      { text: "Skip", data: CALLBACK.skip(applicationId) },
      { text: "View resume", data: CALLBACK.viewResume(applicationId) },
    ],
  ];
}

// The Telegram card: role, company, match %, why it fits, red flags, salary, source, link.
export async function sendJobCardWith(client: TelegramSender, applicationId: number): Promise<void> {
  const app = await prisma.application.findUniqueOrThrow({ where: { id: applicationId }, include: { job: true } });
  const job = app.job;
  const flags = Array.isArray(job.redFlags) ? (job.redFlags as unknown as RedFlag[]) : [];
  const source = SOURCE_META[job.source as SourceId];
  const salary = formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency);

  const lines = [
    `${job.title} - ${job.company}`,
    `Match ${job.matchScore ?? "?"}%${job.remote ? " · Remote" : ""}${job.location ? ` · ${job.location}` : ""}`,
    job.summary ? `Why: ${shorten(job.summary, 240)}` : null,
    flags.length ? `Red flags: ${flags.map((f) => `${f.type} (${f.detail})`).join("; ")}` : null,
    salary ? `Salary: ${salary}` : job.tags.includes("salary_unknown") ? "Salary: not listed" : null,
    `Source: ${source?.label ?? job.source}${source?.attribution ? ` - ${source.attribution}` : ""}`,
    job.url ?? null,
  ].filter((l): l is string => Boolean(l));

  await client.sendMessage(lines.join("\n"), cardButtons(applicationId), { applicationId });
  await logAction("telegram.card_sent", { jobId: job.id, applicationId, loopId: app.loopId }, { matchScore: job.matchScore });
}
