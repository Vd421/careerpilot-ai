// Realistic fixtures that satisfy contracts.ts. Everything is generated from small
// tables so the data stays consistent: a job's status decides whether it has an
// application, resume version, questions, and activity rows.
import type {
  ActivityItem,
  AgentActionType,
  AnswerItem,
  ApplicationDetail,
  ApplicationListItem,
  ApplicationStatus,
  ApplyMethod,
  ApplyPlatform,
  DisplayStatus,
  JobDetail,
  LoopDetail,
  ManualReason,
  QuestionItem,
  RedFlag,
  ResumeVariantItem,
  ResumeVersionItem,
  SettingsDto,
  SourceId,
  SourceMeta,
  SourceStatus,
  TailoredResume,
  VariantStats,
} from "@contracts";
import { SOURCE_IDS } from "@contracts";

const HOUR = 3_600_000;
const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * HOUR).toISOString();

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

type Spec = {
  company: string;
  title: string;
  source: SourceId;
  platform: ApplyPlatform;
  location: string;
  remote: boolean;
  score: number | null;
  salary: [number, number, string] | null;
  status: DisplayStatus;
  flags?: RedFlag[];
  loopId: number | null;
  age: number; // hours since created
  reason?: ManualReason;
  method?: ApplyMethod;
  variant?: "A" | "B";
};

const SPECS: Spec[] = [
  { company: "Northwind Labs", title: "Full Stack Engineer", source: "greenhouse", platform: "greenhouse", location: "Remote, India", remote: true, score: 91, salary: [2400000, 3200000, "INR"], status: "pending_approval", loopId: 1, age: 3 },
  { company: "Lumen Health", title: "Software Engineer, Platform", source: "lever", platform: "lever", location: "Bengaluru", remote: false, score: 88, salary: [2000000, 2800000, "INR"], status: "pending_approval", loopId: 1, age: 5 },
  { company: "Tidewater", title: "Junior Full Stack Developer", source: "ashby", platform: "ashby", location: "Remote", remote: true, score: 86, salary: [55000, 72000, "USD"], status: "pending_approval", loopId: 2, age: 8 },
  { company: "Fieldnote", title: "Backend Engineer (Node.js)", source: "jsearch", platform: "other", location: "Pune", remote: false, score: 82, salary: null, status: "pending_approval", loopId: 1, age: 11, flags: [{ type: "salary", detail: "Salary not listed" }] },
  { company: "Kestrel Systems", title: "AI Application Developer", source: "remotive", platform: "other", location: "Remote, EMEA", remote: true, score: 79, salary: [60000, 80000, "EUR"], status: "pending_approval", loopId: 2, age: 14, flags: [{ type: "location", detail: "Prefers EMEA time zones" }] },
  { company: "Orchard Pay", title: "Software Engineer I", source: "greenhouse", platform: "greenhouse", location: "Hyderabad", remote: false, score: 84, salary: [1800000, 2400000, "INR"], status: "needs_answers", loopId: 1, age: 20 },
  { company: "Brightpath", title: "Full Stack Developer", source: "lever", platform: "lever", location: "Remote, India", remote: true, score: 87, salary: [2200000, 3000000, "INR"], status: "needs_answers", loopId: 1, age: 26 },
  { company: "Cobalt Robotics", title: "Web Application Engineer", source: "ashby", platform: "ashby", location: "Remote", remote: true, score: 90, salary: [70000, 95000, "USD"], status: "approved", loopId: 2, age: 30, variant: "B" },
  { company: "Meridian Data", title: "Software Developer", source: "greenhouse", platform: "greenhouse", location: "Gurugram", remote: false, score: 85, salary: [1900000, 2500000, "INR"], status: "approved", loopId: 1, age: 34, variant: "A" },
  { company: "Paperplane", title: "Frontend Engineer, React", source: "lever", platform: "lever", location: "Remote, India", remote: true, score: 83, salary: [1800000, 2600000, "INR"], status: "applied", loopId: 1, age: 50, method: "auto", variant: "A" },
  { company: "Quill & Co", title: "Full Stack Engineer", source: "greenhouse", platform: "greenhouse", location: "Remote", remote: true, score: 89, salary: [65000, 85000, "USD"], status: "applied", loopId: 2, age: 56, method: "auto", variant: "B" },
  { company: "Harbor Analytics", title: "Junior Software Engineer", source: "ashby", platform: "ashby", location: "Mumbai", remote: false, score: 80, salary: [1500000, 2100000, "INR"], status: "applied", loopId: 1, age: 72, method: "auto", variant: "A" },
  { company: "Sable Cloud", title: "Backend Developer", source: "himalayas", platform: "other", location: "Remote", remote: true, score: 78, salary: [50000, 65000, "USD"], status: "applied", loopId: 2, age: 80, method: "manual", variant: "B" },
  { company: "Ironleaf", title: "Software Engineer", source: "greenhouse", platform: "greenhouse", location: "Remote, India", remote: true, score: 92, salary: [2600000, 3400000, "INR"], status: "replied", loopId: 1, age: 120, method: "auto", variant: "A" },
  { company: "Vantage Edge", title: "Full Stack Engineer, AI Products", source: "lever", platform: "lever", location: "Bengaluru", remote: false, score: 93, salary: [2800000, 3600000, "INR"], status: "interview", loopId: 1, age: 150, method: "auto", variant: "A" },
  { company: "Pinecrest", title: "Associate Software Engineer", source: "jsearch", platform: "other", location: "Chennai", remote: false, score: 76, salary: [1400000, 1900000, "INR"], status: "rejected", loopId: 1, age: 190, method: "manual", variant: "A" },
  { company: "Gridline", title: "Node.js Developer", source: "arbeitnow", platform: "other", location: "Berlin (visa sponsorship)", remote: false, score: 74, salary: [48000, 58000, "EUR"], status: "manual", loopId: 2, age: 18, reason: "unsupported_platform", flags: [{ type: "visa", detail: "Relocation required" }] },
  { company: "Atlas Freight", title: "Software Engineer, Internal Tools", source: "greenhouse", platform: "greenhouse", location: "Noida", remote: false, score: 81, salary: [1700000, 2300000, "INR"], status: "manual", loopId: 1, age: 28, reason: "captcha" },
  { company: "Foxglove", title: "Staff Engineer", source: "lever", platform: "lever", location: "Remote", remote: true, score: 38, salary: [140000, 180000, "USD"], status: "filtered_out", loopId: 2, age: 40, flags: [{ type: "seniority", detail: "Requires 10+ years" }] },
  { company: "Rowan Digital", title: "Senior Backend Engineer", source: "adzuna", platform: "other", location: "London", remote: false, score: 42, salary: [80000, 100000, "GBP"], status: "filtered_out", loopId: 2, age: 44, flags: [{ type: "seniority", detail: "Senior title, 6+ years" }, { type: "visa", detail: "UK right to work required" }] },
  { company: "Mapleton", title: "Software Developer", source: "jsearch", platform: "other", location: "Delhi", remote: false, score: 55, salary: [600000, 900000, "INR"], status: "filtered_out", loopId: 1, age: 60, flags: [{ type: "salary", detail: "Below your INR floor" }] },
  { company: "Helio Systems", title: "Platform Engineer", source: "ashby", platform: "ashby", location: "Remote", remote: true, score: 77, salary: [60000, 78000, "USD"], status: "scored", loopId: 2, age: 6 },
  { company: "Tern", title: "Full Stack Developer", source: "lever", platform: "lever", location: "Remote, India", remote: true, score: 73, salary: [1600000, 2200000, "INR"], status: "scored", loopId: 1, age: 9 },
  { company: "Cinder", title: "Application Developer", source: "remoteok", platform: "other", location: "Remote", remote: true, score: 71, salary: null, status: "scored", loopId: 2, age: 12, flags: [{ type: "salary", detail: "Salary not listed" }] },
  { company: "Alder & Finch", title: "Web Developer", source: "weworkremotely", platform: "other", location: "Remote", remote: true, score: null, salary: null, status: "discovered", loopId: 2, age: 1 },
  { company: "Zephyr Labs", title: "TypeScript Engineer", source: "greenhouse", platform: "greenhouse", location: "Remote, India", remote: true, score: null, salary: [2000000, 2800000, "INR"], status: "discovered", loopId: 1, age: 2 },
  { company: "Copperline", title: "Software Engineer, Growth", source: "adzuna", platform: "other", location: "Pune", remote: false, score: null, salary: [1500000, 2000000, "INR"], status: "discovered", loopId: 1, age: 2 },
  { company: "Juniper Works", title: "React Developer", source: "manual", platform: "other", location: "Remote", remote: true, score: 84, salary: null, status: "skipped", loopId: null, age: 90 },
  { company: "Delta Quay", title: "Backend Engineer", source: "lever", platform: "lever", location: "Hyderabad", remote: false, score: 69, salary: [1500000, 2000000, "INR"], status: "skipped", loopId: 1, age: 100 },
  { company: "Nimbus Works", title: "Software Engineer, Payments", source: "manual", platform: "other", location: "Remote", remote: true, score: 87, salary: null, status: "applied", loopId: null, age: 96, method: "manual", variant: "A" },
];

const SKILLS = ["TypeScript", "React", "Node.js", "PostgreSQL", "Prisma", "REST APIs", "Tailwind CSS", "Docker", "Git", "C++", "Python", "Testing (Vitest)", "CI/CD", "GraphQL", "AWS", "Kubernetes", "Redis", "Next.js"];
const HAVE = SKILLS.slice(0, 12);
const GAPS = ["GraphQL", "AWS", "Kubernetes", "Redis", "Next.js"];

const APP_STATUSES: ApplicationStatus[] = ["pending_approval", "skipped", "needs_answers", "approved", "applied", "manual", "replied", "interview", "rejected", "offer"];
const isAppStatus = (s: DisplayStatus): s is ApplicationStatus => (APP_STATUSES as string[]).includes(s);

export const SOURCE_META: SourceMeta[] = [
  { id: "manual", label: "Pasted JD / URL", minIntervalMinutes: 0, attribution: null, needsKey: null },
  { id: "jsearch", label: "JSearch (RapidAPI)", minIntervalMinutes: 360, attribution: "Jobs via JSearch", needsKey: "RAPIDAPI_KEY" },
  { id: "adzuna", label: "Adzuna", minIntervalMinutes: 360, attribution: "Jobs by Adzuna", needsKey: "ADZUNA_APP_KEY" },
  { id: "remotive", label: "Remotive", minIntervalMinutes: 720, attribution: "Source: Remotive (remotive.com)", needsKey: null },
  { id: "remoteok", label: "RemoteOK", minIntervalMinutes: 720, attribution: "Source: RemoteOK (remoteok.com)", needsKey: null },
  { id: "himalayas", label: "Himalayas", minIntervalMinutes: 720, attribution: "Source: Himalayas (himalayas.app)", needsKey: null },
  { id: "arbeitnow", label: "Arbeitnow", minIntervalMinutes: 720, attribution: "Source: Arbeitnow (arbeitnow.com)", needsKey: null },
  { id: "weworkremotely", label: "We Work Remotely", minIntervalMinutes: 720, attribution: "Source: We Work Remotely", needsKey: null },
  { id: "greenhouse", label: "Greenhouse boards", minIntervalMinutes: 240, attribution: null, needsKey: null },
  { id: "lever", label: "Lever boards", minIntervalMinutes: 240, attribution: null, needsKey: null },
  { id: "ashby", label: "Ashby boards", minIntervalMinutes: 240, attribution: null, needsKey: null },
];

function descriptionFor(s: Spec): string {
  return `${s.company} is hiring a ${s.title}${s.remote ? " (remote)" : ` based in ${s.location}`}.

What you will do
- Build and ship features across a TypeScript, React and Node.js codebase.
- Design clean REST APIs backed by PostgreSQL and own them end to end.
- Write tests, review code, and improve developer tooling.
- Work closely with product and design in small, fast-moving teams.

What we are looking for
- Solid fundamentals in data structures and algorithms.
- Experience with React, Node.js and a relational database.
- Comfort with Git, CI pipelines and containers.
- Nice to have: GraphQL, AWS, or experience integrating LLM APIs.

About ${s.company}
We are a small team that values clear writing, calm releases and people who finish what they start.`;
}

function tailoredFor(variant: "A" | "B", seed: number): TailoredResume {
  const a = variant === "A";
  return {
    headline: a
      ? "Full stack developer with a DSA foundation and hands-on experience building internal tools."
      : "Developer focused on TypeScript web apps and API integrations, with a strong algorithms background.",
    sections: [
      {
        sourceId: "exp-service-desk",
        bullets: [
          { sourceBulletId: "exp-service-desk-1", text: a ? "Resolved user-facing incidents across hardware, network and identity systems, documenting fixes in a shared knowledge base." : "Diagnosed and resolved incidents across systems, then wrote knowledge-base articles that reduced repeat tickets." },
          { sourceBulletId: "exp-service-desk-2", text: "Automated recurring support tasks with scripts, saving the team manual effort every week." },
          { sourceBulletId: "exp-service-desk-3", text: "Communicated technical issues clearly to non-technical staff under time pressure." },
        ],
      },
      {
        sourceId: "proj-careerpilot",
        bullets: [
          { sourceBulletId: "proj-careerpilot-1", text: "Built a Node.js and Express API with PostgreSQL and Prisma to score job descriptions against a structured resume." },
          { sourceBulletId: "proj-careerpilot-2", text: seed % 2 ? "Added Vitest suites with fakes for model calls so tests run offline." : "Wrote tests with injected fakes so every module runs without network access." },
        ],
      },
    ],
    skillsOrder: a ? ["TypeScript", "React", "Node.js", "PostgreSQL", "Prisma", "Docker", "Git", "C++"] : ["Node.js", "TypeScript", "PostgreSQL", "REST APIs", "React", "Python", "Git", "C++"],
    coverNote: "Hello, I am applying for this role because it matches the full stack work I have been building. Happy to share more detail on any project.",
  };
}

// ---------------------------------------------------------------------------
// Store builders
// ---------------------------------------------------------------------------

export interface MockDb {
  jobs: JobDetail[];
  applications: ApplicationDetail[];
  resumeVersions: Map<number, ResumeVersionItem>;
  questions: QuestionItem[];
  answers: AnswerItem[];
  activity: ActivityItem[];
  loops: LoopDetail[];
  variants: ResumeVariantItem[];
  sources: SourceStatus[];
  settings: SettingsDto;
  telegramConnected: boolean;
}

export function buildDb(): MockDb {
  const variants: ResumeVariantItem[] = [
    { id: 1, name: "A", filePath: "data/private/resume.json" },
    { id: 2, name: "B", filePath: "data/private/resume.b.json" },
  ];
  const resumeVersions = new Map<number, ResumeVersionItem>();
  const jobs: JobDetail[] = [];
  const applications: ApplicationDetail[] = [];
  let rvId = 1;
  let appId = 1;

  SPECS.forEach((s, i) => {
    const id = i + 1;
    const hasApp = isAppStatus(s.status);
    const versions: ResumeVersionItem[] = [];
    let rvIdForApp: number | null = null;
    const needsVersion = ["approved", "applied", "manual", "replied", "interview", "rejected", "needs_answers"].includes(s.status);
    if (needsVersion) {
      const v = s.variant ?? "A";
      const rv: ResumeVersionItem = {
        id: rvId++,
        variantName: v,
        tailored: tailoredFor(v, id),
        pdfUrl: `/api/resume-versions/${rvId - 1}/pdf`,
        createdAt: iso(s.age - 0.5),
      };
      resumeVersions.set(rv.id, rv);
      versions.push(rv);
      rvIdForApp = rv.id;
    }
    let application: ApplicationListItem | null = null;
    if (hasApp && isAppStatus(s.status)) {
      const applied = ["applied", "replied", "interview", "rejected", "offer"].includes(s.status);
      application = {
        id: appId++,
        jobId: id,
        company: s.company,
        title: s.title,
        status: s.status,
        method: applied ? (s.method ?? "auto") : s.status === "manual" ? "manual" : null,
        resumeVersionId: rvIdForApp,
        variantName: s.variant ?? (rvIdForApp ? "A" : null),
        appliedAt: applied ? iso(s.age - 4) : null,
        screenshotUrl: s.status === "approved" || (applied && (s.method ?? "auto") === "auto") ? `/api/screenshots/app-${appId - 1}.png` : null,
        manualReason: s.status === "manual" ? (s.reason ?? "error") : null,
        applyUrl: `https://boards.example.com/${s.company.toLowerCase().replace(/[^a-z]+/g, "-")}/jobs/${1000 + id}`,
        createdAt: iso(s.age - 1),
      };
    }
    const job: JobDetail = {
      id,
      company: s.company,
      title: s.title,
      source: s.source,
      url: `https://boards.example.com/${s.company.toLowerCase().replace(/[^a-z]+/g, "-")}/jobs/${1000 + id}`,
      location: s.location,
      remote: s.remote,
      matchScore: s.score,
      salaryMin: s.salary?.[0] ?? null,
      salaryMax: s.salary?.[1] ?? null,
      salaryCurrency: s.salary?.[2] ?? null,
      redFlags: s.flags ?? [],
      tags: s.salary ? [] : ["salary_unknown"],
      status: s.status,
      applicationId: application?.id ?? null,
      loopId: s.loopId,
      createdAt: iso(s.age),
      description: descriptionFor(s),
      summary:
        s.score == null
          ? null
          : s.score >= 80
            ? `Strong fit: the stack (TypeScript, React, Node.js, PostgreSQL) lines up with your projects and the seniority is entry to mid level.`
            : s.score >= 65
              ? `Reasonable fit on core skills, with a few gaps to close. Worth a look if the location works.`
              : `Weak fit: the level or constraints do not match your profile.`,
      matchedSkills: s.score == null ? [] : HAVE.filter((_, k) => (k + id) % 3 !== 0).slice(0, 4 + (id % 4)),
      missingSkills: s.score == null ? [] : GAPS.filter((_, k) => (k + id) % 2 === 0).slice(0, 1 + (id % 3)),
      filterReasons: s.status === "filtered_out" ? (s.flags ?? []).map((f) => f.detail) : [],
      applyPlatform: s.platform,
      attribution: SOURCE_META.find((m) => m.id === s.source)?.attribution ?? null,
      resumeVersions: versions,
      application,
    };
    jobs.push(job);
    if (application) {
      applications.push({
        ...application,
        pdfUrl: rvIdForApp ? `/api/resume-versions/${rvIdForApp}/pdf` : null,
        questions: [],
      });
    }
  });

  // Questions -------------------------------------------------------------
  const appFor = (company: string) => applications.find((a) => a.company === company)!;
  let qid = 1;
  const mkQ = (company: string, text: string, status: QuestionItem["status"], fieldType: QuestionItem["fieldType"] = "textarea", answer: AnswerItem | null = null, options: string[] = [], via: QuestionItem["askedVia"] = "telegram"): QuestionItem => {
    const app = appFor(company);
    return {
      id: qid++,
      applicationId: app.id,
      company,
      jobTitle: app.title,
      text,
      fieldType,
      options,
      required: true,
      status,
      askedVia: status === "pending" ? null : via,
      answer,
      createdAt: iso(10 + qid),
    };
  };
  const ans = (id: number, key: string | null, questionText: string, raw: string, polished: string | null, reusable: boolean, approved = true, tags: string[] = []): AnswerItem => ({
    id, key, questionText, rawAnswer: raw, polishedAnswer: polished, approved, reusable, tags, updatedAt: iso(30 + id * 7),
  });
  const answers: AnswerItem[] = [
    ans(1, "notice_period", "What is your notice period?", "30 days", "30 days.", true, true, ["notice"]),
    ans(2, "work_auth_india", "Are you authorized to work in India?", "yes citizen", "Yes, I am an Indian citizen.", true, true, ["authorization"]),
    ans(3, "expected_ctc", "What is your expected CTC?", "18 lpa negotiable", "My expectation is around 18 LPA, and I am open to discussion.", true, true, ["compensation"]),
    ans(4, "current_location", "Where are you currently based?", "Delhi NCR", "I am based in Delhi NCR.", true, true, ["location"]),
    ans(5, "linkedin_url", "LinkedIn profile URL", "linkedin.com/in/example", "https://linkedin.com/in/example", true, true, ["links"]),
    ans(6, "github_url", "GitHub profile URL", "github.com/example", "https://github.com/example", true, true, ["links"]),
    ans(7, null, "Why do you want to work at Quill & Co?", "like the writing tools and small team", "I am drawn to Quill & Co for its writing tools and its small, focused team.", false, true, ["why_company"]),
    ans(8, null, "Why do you want to work at Ironleaf?", "ironleaf builds dev infra, i enjoy backend work", "Ironleaf builds developer infrastructure, which fits the backend work I enjoy most.", false, true, ["why_company"]),
    ans(9, "willing_to_relocate", "Are you willing to relocate?", "yes within india", "Yes, within India.", true, true, ["location"]),
  ];

  const questions: QuestionItem[] = [
    mkQ("Orchard Pay", "Why do you want to work at Orchard Pay?", "pending"),
    mkQ("Orchard Pay", "Describe a project where you handled money or sensitive data.", "pending"),
    mkQ("Brightpath", "Are you comfortable working in a startup with ambiguous scope?", "pending", "radio", null, ["Yes", "No", "Somewhat"]),
    mkQ("Brightpath", "What is your notice period?", "answered", "text", answers[0], [], "bank"),
    mkQ("Cobalt Robotics", "Link to your GitHub profile", "answered", "text", answers[5], [], "bank"),
    mkQ("Cobalt Robotics", "Are you authorized to work in India?", "answered", "select", answers[1], ["Yes", "No"], "bank"),
    mkQ("Meridian Data", "Expected CTC", "answered", "text", answers[2], [], "bank"),
    mkQ("Quill & Co", "Why do you want to work at Quill & Co?", "answered", "textarea", answers[6], [], "telegram"),
    mkQ("Ironleaf", "Why do you want to work at Ironleaf?", "answered", "textarea", answers[7], [], "telegram"),
    mkQ("Atlas Freight", "Tell us about a time you debugged something difficult.", "asked", "textarea", null, [], "telegram"),
    mkQ("Gridline", "Are you authorized to work in the EU?", "answered", "select", ans(10, null, "Are you authorized to work in the EU?", "no", "No.", false, true, ["authorization"]), ["Yes", "No"], "telegram"),
  ];
  for (const q of questions) {
    const app = applications.find((a) => a.id === q.applicationId);
    app?.questions.push(q);
  }

  // Activity ----------------------------------------------------------------
  const activity: ActivityItem[] = [];
  let aid = 1;
  const push = (type: AgentActionType, hoursAgo: number, jobIdx: number | null, detail: Record<string, unknown> = {}, loopId: number | null = null) => {
    const j = jobIdx != null ? jobs[jobIdx] : null;
    activity.push({
      id: aid++, type,
      jobId: j?.id ?? null,
      applicationId: j?.applicationId ?? null,
      loopId: loopId ?? j?.loopId ?? null,
      jobLabel: j ? `${j.company} · ${j.title}` : null,
      detail, createdAt: iso(hoursAgo),
    });
  };
  jobs.forEach((j, idx) => {
    const t = (j.createdAt ? (Date.now() - new Date(j.createdAt).getTime()) / HOUR : 1);
    push("job.discovered", t, idx, { source: j.source });
    if (j.matchScore != null) push("job.scored", t - 0.2, idx, { score: j.matchScore });
    if (j.status === "filtered_out") push("job.filtered_out", t - 0.25, idx, { reasons: j.filterReasons });
    if (j.applicationId != null) {
      push("job.pushed", t - 0.4, idx);
      push("telegram.card_sent", t - 0.45, idx);
    }
    if (j.resumeVersions.length) push("resume.tailored", t - 0.8, idx, { variant: j.resumeVersions[0].variantName });
    if (j.resumeVersions.length) push("resume.pdf_rendered", t - 0.85, idx);
    if (["applied", "replied", "interview", "rejected"].includes(j.status) && j.application?.method === "auto") {
      push("apply.filled", t - 3.5, idx);
      push("apply.submit_approved", t - 3.8, idx);
      push("apply.submitted", t - 4, idx);
    }
    if (j.status === "approved") push("apply.dry_run", t - 3, idx);
    if (j.status === "manual") push("application.manual", t - 2, idx, { reason: j.application?.manualReason });
  });
  push("loop.run_finished", 2, null, { found: 14, kept: 6 }, 1);
  push("loop.run_finished", 5, null, { found: 9, kept: 3 }, 2);
  push("settings.updated", 40, null, { key: "matchThreshold" });
  push("question.matched_bank", 33, 8, { key: "notice_period" });
  push("answer.approved", 31, 7, {});
  activity.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  activity.forEach((a, i) => (a.id = activity.length - i));

  // Loops -------------------------------------------------------------------
  const variantStats = (variantId: number, name: string, found: number, approved: number, applied: number, replied: number): VariantStats => ({
    variantId, variantName: name, found, approved, applied, replied, responseRate: applied ? replied / applied : 0,
  });
  const loops: LoopDetail[] = [
    {
      id: 1, name: "India full stack", keywords: ["full stack", "node.js", "react", "software engineer"], locations: ["India", "Remote", "Bengaluru", "Pune"],
      sources: ["greenhouse", "lever", "ashby", "adzuna", "jsearch"], filters: { minScore: 75, remoteOnly: false, excludeKeywords: ["senior", "staff", "lead", "principal"] },
      resumeVariantIds: [1], schedule: "0 */6 * * *", active: true, lastRunAt: iso(2), nextRunAt: new Date(Date.now() + 4 * HOUR).toISOString(),
      stats: { found: 118, approved: 21, applied: 14, replied: 3, responseRate: 3 / 14 },
      variants: [variantStats(1, "A", 118, 21, 14, 3)],
    },
    {
      id: 2, name: "Remote AI product", keywords: ["ai engineer", "application developer", "typescript"], locations: ["Remote"],
      sources: ["remotive", "remoteok", "himalayas", "weworkremotely", "ashby"], filters: { minScore: 78, remoteOnly: true, excludeKeywords: ["senior", "staff"], salaryFloors: { USD: 40000 } },
      resumeVariantIds: [1, 2], schedule: "0 */12 * * *", active: true, lastRunAt: iso(5), nextRunAt: new Date(Date.now() + 7 * HOUR).toISOString(),
      stats: { found: 76, approved: 12, applied: 9, replied: 2, responseRate: 2 / 9 },
      variants: [variantStats(1, "A", 38, 5, 4, 0), variantStats(2, "B", 38, 7, 5, 2)],
    },
  ];

  const sources: SourceStatus[] = SOURCE_META.map((m) => ({
    ...m,
    enabled: !["jsearch", "adzuna"].includes(m.id),
    configured: m.needsKey == null || m.id === "adzuna",
  }));
  sources.find((s) => s.id === "jsearch")!.configured = false;
  sources.find((s) => s.id === "adzuna")!.enabled = true;

  const settings: SettingsDto = {
    salaryFloors: { INR: 1200000, USD: 30000, EUR: 30000 },
    noticeDays: 60,
    matchThreshold: 75,
    maxYearsRequired: 3,
    sources: Object.fromEntries(SOURCE_IDS.map((id) => [id, sources.find((s) => s.id === id)?.enabled ?? false])),
    dailyCap: 10,
    maxScoresPerDay: 60,
    maxTailorsPerDay: 20,
    dryRun: true,
    telegramLinked: true,
  };

  return { jobs, applications, resumeVersions, questions, answers, activity, loops, variants, sources, settings, telegramConnected: true };
}
