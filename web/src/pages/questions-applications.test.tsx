import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "@/test/utils";

describe("questions answer flow", () => {
  it("answer -> polished -> Use removes it from pending and can save to the bank", async () => {
    const user = userEvent.setup();
    renderApp("/questions");
    const card = (await screen.findByText("Why do you want to work at Orchard Pay?")).closest("[aria-label]") as HTMLElement;
    const polishBtn = within(card).getByRole("button", { name: /polish answer/i });
    expect(polishBtn).toBeDisabled();

    await user.type(within(card).getByLabelText("Your answer"), "love the payments focus and small team");
    await user.click(polishBtn);

    expect(await within(card).findByText("Love the payments focus and small team.")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: /use my original/i })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: /^edit$/i })).toBeInTheDocument();

    await user.click(within(card).getByRole("switch", { name: /save for future jobs/i }));
    await user.click(within(card).getByRole("button", { name: /^use$/i }));
    await waitFor(() => expect(screen.queryByText("Why do you want to work at Orchard Pay?")).toBeNull());

    await user.click(screen.getByRole("tab", { name: "Answer bank" }));
    expect(await screen.findByText("Love the payments focus and small team.")).toBeInTheDocument();
  });

  it("lets me edit the polished text before using it", async () => {
    const user = userEvent.setup();
    renderApp("/questions");
    const card = (await screen.findByText("Why do you want to work at Orchard Pay?")).closest("[aria-label]") as HTMLElement;
    await user.type(within(card).getByLabelText("Your answer"), "good team");
    await user.click(within(card).getByRole("button", { name: /polish answer/i }));
    await user.click(await within(card).findByRole("button", { name: /^edit$/i }));
    const box = within(card).getByLabelText("Edit polished answer");
    await user.clear(box);
    await user.type(box, "A better line from me.");
    await user.click(within(card).getByRole("button", { name: /save edit/i }));
    await user.click(screen.getByRole("tab", { name: "Answer bank" }));
    expect(await screen.findByText("A better line from me.")).toBeInTheDocument();
  });

  it("filters the answer bank by reusable", async () => {
    const user = userEvent.setup();
    renderApp("/questions");
    await user.click(await screen.findByRole("tab", { name: "Answer bank" }));
    await screen.findByText("What is your notice period?");
    await user.click(screen.getByRole("radio", { name: "Job-specific" }));
    await waitFor(() => expect(screen.queryByText("What is your notice period?")).toBeNull());
    expect(screen.getByText("Why do you want to work at Quill & Co?")).toBeInTheDocument();
  });
});

describe("applications", () => {
  it("shows the board by status and switches to the table", async () => {
    const user = userEvent.setup();
    renderApp("/applications");
    expect(await screen.findByRole("region", { name: "Applied" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /table/i }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("manual applications give link, PDF and copyable answers, but no submit", async () => {
    renderApp("/applications?app=17");
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Apply by hand")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /i applied/i })).toBeInTheDocument();
    expect(within(dialog).getByText(/Platform is not auto-filled/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /^(apply|submit)\b/i })).toBeNull();
  });
});
