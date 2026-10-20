import type { TailoredResume } from "../contracts.js";
import type { Resume } from "../resume/schema.js";

export function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const CSS = `
  @page { size: A4; margin: 14mm 16mm; }
  body { font-family: Georgia, "Times New Roman", serif; font-size: 10.5pt; line-height: 1.35; color: #111; margin: 0; }
  h1 { font-size: 20pt; margin: 0 0 2pt; }
  h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid #333; padding-bottom: 2pt; margin: 12pt 0 6pt; }
  .contact, .headline { margin: 0 0 4pt; }
  .item { margin: 0 0 7pt; }
  .item-head { font-weight: bold; margin: 0; }
  .item-sub { margin: 0; font-style: italic; }
  ul { margin: 3pt 0 0; padding-left: 16pt; }
  li { margin: 0 0 2pt; }
  a { color: inherit; text-decoration: none; }
`;

// Pure function: source resume (contact, education, company/role names) + tailored bullets -> one HTML page.
// Single column, real text, no tables or images, so applicant-tracking systems parse it cleanly.
// Bullet text comes ONLY from `tailored`; nothing from the source bullets is printed.
export function renderResumeHtml(resume: Resume, tailored: TailoredResume): string {
  const { basics } = resume;
  const contact = [basics.email, basics.phone, basics.location, ...basics.links.map((l) => l.url)]
    .filter((x): x is string => Boolean(x))
    .map(esc)
    .join(" | ");

  const bulletList = (bullets: { text: string }[]) =>
    `<ul>${bullets.map((b) => `<li>${esc(b.text)}</li>`).join("")}</ul>`;

  const expById = new Map(resume.experience.map((e) => [e.id, e]));
  const projById = new Map(resume.projects.map((p) => [p.id, p]));

  const experience = tailored.sections
    .filter((s) => expById.has(s.sourceId))
    .map((s) => {
      const e = expById.get(s.sourceId)!;
      const dates = `${e.start} - ${e.end ?? "Present"}`;
      return `<div class="item"><p class="item-head">${esc(e.role)}, ${esc(e.company)}</p>
<p class="item-sub">${esc([e.location, dates].filter(Boolean).join(" | "))}</p>${bulletList(s.bullets)}</div>`;
    });

  const projects = tailored.sections
    .filter((s) => projById.has(s.sourceId))
    .map((s) => {
      const p = projById.get(s.sourceId)!;
      return `<div class="item"><p class="item-head">${esc(p.name)}</p>
<p class="item-sub">${esc(p.tech.join(", "))}</p>${bulletList(s.bullets)}</div>`;
    });

  // Tailored order first, then any remaining skills so nothing real is hidden from ATS keyword matching.
  const all = resume.skills.flatMap((g) => g.items);
  const lower = (s: string) => s.toLowerCase();
  const ordered = tailored.skillsOrder
    .map((s) => all.find((a) => lower(a) === lower(s)))
    .filter((s): s is string => Boolean(s));
  const rest = all.filter((a) => !ordered.some((o) => lower(o) === lower(a)));
  const skills = [...new Set([...ordered, ...rest])];

  const education = resume.education.map(
    (ed) =>
      `<div class="item"><p class="item-head">${esc(ed.degree)}, ${esc(ed.school)}</p>
<p class="item-sub">${esc([ed.location, ed.start ? `${ed.start} - ${ed.end}` : ed.end].filter(Boolean).join(" | "))}</p></div>`,
  );

  const parts = [
    `<h1>${esc(basics.name)}</h1>`,
    `<p class="contact">${contact}</p>`,
    tailored.headline ? `<p class="headline">${esc(tailored.headline)}</p>` : "",
    skills.length ? `<h2>Skills</h2><p>${skills.map(esc).join(", ")}</p>` : "",
    experience.length ? `<h2>Experience</h2>${experience.join("")}` : "",
    projects.length ? `<h2>Projects</h2>${projects.join("")}` : "",
    education.length ? `<h2>Education</h2>${education.join("")}` : "",
  ];

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(basics.name)} - Resume</title><style>${CSS}</style></head>
<body>${parts.filter(Boolean).join("\n")}</body></html>`;
}
