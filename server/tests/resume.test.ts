import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadResume, ResumeError } from "../src/resume/load.js";

const EXAMPLE_PATH = resolve(import.meta.dirname, "../../data/resume.example.json");

// Bad resumes are written to a temp folder, deleted after the tests
const tmp = mkdtempSync(join(tmpdir(), "resume-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function writeTemp(name: string, content: string): string {
  const path = join(tmp, name);
  writeFileSync(path, content);
  return path;
}

// A fresh copy of the example each time, so one test's edits can't leak into another
function exampleResume() {
  return JSON.parse(readFileSync(EXAMPLE_PATH, "utf8"));
}

describe("loadResume", () => {
  it("loads the example resume", () => {
    const resume = loadResume(EXAMPLE_PATH);

    expect(resume.basics.name).toBe("Asha Example");
    expect(resume.experience[0].bullets[0].id).toBe("acme-1");
    expect(resume.experience[0].end).toBeNull(); // current job
  });

  it("rejects a resume missing a required field, naming the field", () => {
    const data = exampleResume();
    delete data.experience[0].company;
    const path = writeTemp("missing-field.json", JSON.stringify(data));

    expect(() => loadResume(path)).toThrow(ResumeError);
    expect(() => loadResume(path)).toThrow(/experience\[0\]\.company/);
  });

  it("rejects duplicate bullet ids", () => {
    const data = exampleResume();
    data.experience[0].bullets[1].id = "acme-1"; // same as bullet 0
    const path = writeTemp("duplicate-id.json", JSON.stringify(data));

    expect(() => loadResume(path)).toThrow(/Duplicate id in resume: "acme-1"/);
  });

  it("rejects a bullet id that duplicates a project id", () => {
    const data = exampleResume();
    data.projects[0].bullets[0].id = "acme"; // same as the experience id
    const path = writeTemp("duplicate-across.json", JSON.stringify(data));

    expect(() => loadResume(path)).toThrow(/Duplicate id/);
  });

  it("rejects broken JSON", () => {
    const path = writeTemp("broken.json", '{ "basics": { "name": "Asha" ');

    expect(() => loadResume(path)).toThrow(/not valid JSON/);
  });

  it("rejects a file that doesn't exist", () => {
    expect(() => loadResume(join(tmp, "nope.json"))).toThrow(/Cannot read resume file/);
  });
});
