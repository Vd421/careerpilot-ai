import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "@/test/utils";

describe("overview", () => {
  it("shows the four stat cards and the attention list", async () => {
    renderApp("/");
    for (const label of ["Discovered", "Applied", "Awaiting me", "Replies"]) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
    await waitFor(() => expect(screen.getByLabelText(/^Discovered: \d+/)).toBeInTheDocument());
    const attention = screen.getByText("Needs your attention").closest("div")!.parentElement!;
    expect(await within(attention).findAllByText("Approve on Telegram")).not.toHaveLength(0);
  });

  it("never offers an apply or submit button", async () => {
    renderApp("/");
    await screen.findByText("Needs your attention");
    expect(screen.queryByRole("button", { name: /^(apply|submit)/i })).toBeNull();
  });
});

describe("activity", () => {
  it("filters the timeline by type group", async () => {
    const user = userEvent.setup();
    renderApp("/activity");
    expect((await screen.findAllByText("Scored a job")).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Loops and settings" }));
    await waitFor(() => expect(screen.queryByText("Scored a job")).toBeNull());
    expect(screen.getAllByText("Loop run finished").length).toBeGreaterThan(0);
  });
});
