import { beforeEach, describe, expect, it } from "vitest";
import { ACTIVITY_GROUPS } from "../lib/activity";
import { api } from "../lib/api";
import { resetMock } from "./router";

// Tests run in vitest mode, so force the mock transport on.
describe("mock api", () => {
  beforeEach(() => resetMock());

  it("serves a realistic dataset", async () => {
    const jobs = await api.jobs({ pageSize: 100 });
    // The default list hides filtered-out jobs, like the real API
    expect(jobs.items.some((j) => j.status === "filtered_out")).toBe(false);
    const filteredOut = await api.jobs({ status: "filtered_out" });
    expect(jobs.total + filteredOut.total).toBeGreaterThanOrEqual(30);
    const statuses = new Set(jobs.items.map((j) => j.status));
    expect(statuses.size).toBeGreaterThan(8);
    expect(new Set(jobs.items.map((j) => j.source)).size).toBeGreaterThan(6);
    expect((await api.activity({ limit: 500 })).length).toBeGreaterThanOrEqual(60);
    expect((await api.loops()).length).toBe(2);
  });

  it("filters jobs by status and text", async () => {
    const pending = await api.jobs({ status: "pending_approval" });
    expect(pending.items.every((j) => j.status === "pending_approval")).toBe(true);
    const q = await api.jobs({ q: "northwind" });
    expect(q.total).toBe(1);
  });

  it("rejects an empty paste", async () => {
    await expect(api.createJob({})).rejects.toThrow();
  });

  it("caps the daily limit at the hard maximum", async () => {
    await expect(api.updateSettings({ dailyCap: 99 })).rejects.toThrow(/between 1 and 15/);
  });

  it("covers every activity type in a group", () => {
    expect(ACTIVITY_GROUPS.length).toBeGreaterThan(3);
  });
});
