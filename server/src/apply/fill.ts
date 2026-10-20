import { existsSync } from "node:fs";
import { join } from "node:path";
import { HARD_DAILY_CAP, CALLBACK, canTransition, type ApplicationStatus, type ApplyPlatform } from "../contracts.js";
import { prisma } from "../db.js";
import { REPO_ROOT, resolveRepoPath } from "../tailor/paths.js";
import { logAction } from "../telegram/log.js";
import { goManual } from "./manual.js";
import { buildFillPlan, formatLines } from "./plan.js";
import type { ApplyDeps } from "./types.js";
import { relative } from "node:path";

const FOLLOW_UP_DAYS = 7;
const LOCK_STALE_MS = 10 * 60_000; // a lock older than this with no result = a submit that died half-way

function startOfDay(d: Date): Date {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s;
}

const storedPath = (abs: string) => (abs.startsWith(REPO_ROOT) ? relative(REPO_ROOT, abs).replaceAll("\\", "/") : abs);

// The ONLY place that may ask the filler to submit. All of these must hold, checked here in code:
//   approvedAt (my [Apply] tap) AND submitApprovedAt (my [Submit] tap) AND dryRun is false AND the atomic lock was won.
// Safe to re-run (pg-boss retries): finished applications are no-ops, and the lock can only be won once.
export async function fillApplication(applicationId: number, deps: ApplyDeps): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const app = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { job: true, resumeVersion: true, questions: { orderBy: { id: "asc" }, include: { answer: true } } },
  });
  if (!app) return;
  const status = app.status as ApplicationStatus;
  const ctx = { applicationId };
  const where = { jobId: app.jobId, applicationId, loopId: app.loopId };

  if (!app.approvedAt) {
    console.warn(`[apply] application ${applicationId} has no approvedAt, refusing to fill`);
    return;
  }
  if (status !== "approved" || app.appliedAt) return; // skipped, cancelled, manual, already applied, still needs answers...

  const settings = await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  const wantsSubmit = !settings.dryRun && app.submitApprovedAt !== null;

  // Phase 2 retried after a crash: a lock exists but nothing was recorded. We do NOT know if the form went through.
  if (app.submitLockedAt) {
    if (now.getTime() - app.submitLockedAt.getTime() < LOCK_STALE_MS) return; // another worker is submitting right now
    await goManual(deps, applicationId, "error", "a submit was started earlier and I don't know if it went through. Check before applying again");
    return;
  }
  // Already filled and waiting on a decision: don't fill again or re-send the card.
  if (app.filledAt && !wantsSubmit) return;

  // Daily cap (never above 15, whatever the setting says)
  const cap = Math.min(settings.dailyCap, HARD_DAILY_CAP);
  const appliedToday = await prisma.application.count({ where: { status: "applied", appliedAt: { gte: startOfDay(now) } } });
  if (appliedToday >= cap) {
    await logAction("apply.blocked_cap", where, { appliedToday, cap });
    await deps.telegram.sendMessage(`Daily cap reached (${appliedToday}/${cap}). ${app.job.title} at ${app.job.company} stays approved.`, undefined, ctx);
    return;
  }

  const pdf = app.resumeVersion?.pdfPath ? resolveRepoPath(app.resumeVersion.pdfPath) : null;
  if (!pdf || !existsSync(pdf)) {
    await logAction("apply.failed", where, { error: "resume PDF missing" });
    await goManual(deps, applicationId, "error", "resume PDF is missing");
    return;
  }
  const platform = app.job.applyPlatform as ApplyPlatform;
  if (!app.job.url) {
    await goManual(deps, applicationId, "unknown_form", "no link saved for this job");
    return;
  }

  try {
    // Fresh look at the form right before filling: catches a form that changed, or a CAPTCHA that now shows.
    const scan = await deps.filler.prescan(app.job.url, platform);
    if (scan.blocker) {
      await goManual(deps, applicationId, scan.blocker);
      return;
    }
    const resume = await deps.loadResume(app.resumeVariantId);
    const plan = buildFillPlan(scan.fields, app.questions, resume);
    if (plan.missingRequired.length > 0) {
      await goManual(deps, applicationId, "unanswered", plan.missingRequired.map((f) => f.label).join("; "));
      return;
    }

    // ----- the submit decision, in one place -----
    let submit = false;
    if (wantsSubmit) {
      const locked = await prisma.application.updateMany({
        where: { id: applicationId, submitLockedAt: null },
        data: { submitLockedAt: now },
      });
      if (locked.count !== 1) {
        console.warn(`[apply] application ${applicationId}: submit lock already taken, not submitting`);
        return;
      }
      submit = true;
    }

    const screenshotPath = join(deps.screenshotsDir, `${applicationId}-${now.getTime()}.png`);
    let result;
    try {
      result = await deps.filler.fill({
        url: app.job.url,
        platform,
        answers: plan.values,
        resumePdfPath: pdf,
        submit,
        screenshotPath,
      });
    } catch (err) {
      // After the lock we never retry a submit: report and leave it for me.
      await onFailure(deps, applicationId, app.jobId, app.loopId, app.job.title, app.job.company, app.job.url, err, submit);
      return;
    }

    const shot = result.screenshotPath ? storedPath(result.screenshotPath) : null;

    if (!submit) {
      if (!result.ok) {
        if (result.blocker) await goManual(deps, applicationId, result.blocker, result.error ?? undefined);
        else await onFailure(deps, applicationId, app.jobId, app.loopId, app.job.title, app.job.company, app.job.url, new Error(result.error ?? "fill failed"), false, shot);
        return;
      }
      await prisma.application.update({ where: { id: applicationId }, data: { filledAt: now, screenshotPath: shot } });
      await logAction("apply.filled", where, { fields: Object.keys(plan.values).length, screenshotPath: shot });

      if (settings.dryRun) {
        await logAction("apply.dry_run", where, { submitted: false });
        await sendShot(deps, result.screenshotPath, `Dry run: filled, not submitted.\n${app.job.title} at ${app.job.company}`, undefined, applicationId);
      } else {
        const buttons = [[{ text: "Submit", data: CALLBACK.submit(applicationId) }, { text: "Cancel", data: CALLBACK.cancel(applicationId) }]];
        await sendShot(
          deps,
          result.screenshotPath,
          `Ready to submit: ${app.job.title} at ${app.job.company}\n\n${formatLines(plan.lines)}`,
          buttons,
          applicationId,
        );
      }
      return;
    }

    // ----- submitted (or not) -----
    if (result.submitted) {
      const followUp = new Date(now.getTime() + FOLLOW_UP_DAYS * 86_400_000);
      await prisma.application.update({
        where: { id: applicationId },
        data: { status: "applied", appliedAt: now, method: "auto", screenshotPath: shot ?? app.screenshotPath, filledAt: app.filledAt ?? now },
      });
      await logAction("apply.submitted", where, { screenshotPath: shot, resumeVersionId: app.resumeVersionId });
      await sendShot(
        deps,
        result.screenshotPath,
        `Applied to ${app.job.title} at ${app.job.company}.\nFollow-up date: ${followUp.toISOString().slice(0, 10)}`,
        undefined,
        applicationId,
      );
      return;
    }
    // Clicked submit but no confirmation page (or a CAPTCHA popped up): never retry, hand over to me.
    await logAction("apply.failed", where, { error: result.error ?? "no confirmation page after submit", blocker: result.blocker, screenshotPath: shot });
    if (shot) await prisma.application.update({ where: { id: applicationId }, data: { screenshotPath: shot } });
    await goManual(deps, applicationId, result.blocker === "captcha" ? "captcha" : "error", result.error ?? "no confirmation page after submit. Check before applying again");
  } catch (err) {
    await onFailure(deps, applicationId, app.jobId, app.loopId, app.job.title, app.job.company, app.job.url, err, false);
  }
}

async function sendShot(
  deps: ApplyDeps,
  path: string | null,
  caption: string,
  buttons: { text: string; data: string }[][] | undefined,
  applicationId: number,
): Promise<void> {
  if (path && existsSync(path)) await deps.telegram.sendPhoto(path, caption, buttons, { applicationId });
  else await deps.telegram.sendMessage(caption, buttons, { applicationId });
}

// Any exception: log it, ping me, keep the status (it is not the end of the application).
async function onFailure(
  deps: ApplyDeps,
  applicationId: number,
  jobId: number,
  loopId: number | null,
  title: string,
  company: string,
  url: string,
  err: unknown,
  afterLock: boolean,
  screenshot: string | null = null,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await prisma.application.update({ where: { id: applicationId }, data: { lastError: message.slice(0, 500) } });
  await logAction("apply.failed", { jobId, applicationId, loopId }, { error: message, afterLock, screenshotPath: screenshot });
  await deps.telegram.sendMessage(
    `Couldn't ${afterLock ? "submit" : "fill"} ${title} at ${company}: ${message}\n${url}\n${
      afterLock ? "Check the site before trying again." : "You can apply manually with the link above."
    }`,
    undefined,
    { applicationId },
  );
  // Unknown whether a locked submit went through: move to manual so it can't be retried blindly.
  if (afterLock && canTransition("approved", "manual")) {
    await goManual(deps, applicationId, "error", "submit failed half-way. Check before applying again");
  }
}
