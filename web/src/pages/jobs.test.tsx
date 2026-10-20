import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "@/test/utils";

const rows = () => screen.getAllByRole("row").slice(1);

describe("jobs table", () => {
  it("filters by status, search text and clears", async () => {
    const user = userEvent.setup();
    renderApp("/jobs");
    await screen.findByText("Northwind Labs");
    const all = rows().length;
    expect(all).toBeGreaterThan(5);

    await user.selectOptions(screen.getByLabelText("Status"), "applied");
    await waitFor(() => expect(rows().length).toBeLessThan(all));
    for (const r of rows()) expect(within(r).getByText("Applied")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /clear/i }));
    await waitFor(() => expect(rows().length).toBe(all));

    await user.type(screen.getByLabelText("Search jobs"), "cobalt");
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByText("Cobalt Robotics")).toBeInTheDocument();
  });

  it("shows a helpful empty state with an action", async () => {
    const user = userEvent.setup();
    renderApp("/jobs");
    await user.type(await screen.findByLabelText("Search jobs"), "zzzz-nothing");
    expect(await screen.findByText("No jobs match these filters")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /clear filters/i }).length).toBeGreaterThan(0);
  });
});

describe("job drawer", () => {
  it("opens from the URL, shows fit details and has no apply/submit button", async () => {
    renderApp("/jobs?job=1");
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Matched")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /tailor resume/i })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /^(apply|submit)/i })).toBeNull();
    expect(within(dialog).getByText("Approve on Telegram")).toBeInTheDocument();
  });

  it("opens when a row is clicked", async () => {
    const user = userEvent.setup();
    renderApp("/jobs");
    await user.click(await screen.findByText("Lumen Health"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

describe("job drawer actions", () => {
  it("offers Send to Telegram only when no card exists, and sending hides it", async () => {
    const user = userEvent.setup();
    renderApp("/jobs?job=22");
    const dialog = await screen.findByRole("dialog");
    const btn = await within(dialog).findByRole("button", { name: /send to telegram/i });
    await user.click(btn);
    expect(await screen.findByText("Approve on Telegram")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send to telegram/i })).toBeNull();
  });
});
