import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "@/test/utils";

// Orchard Pay is waiting on answers and already has a tailored resume in the demo data.
async function openResumeTab(company: string) {
  const user = userEvent.setup();
  renderApp("/jobs");
  await user.type(await screen.findByLabelText("Search jobs"), company);
  await user.click(await screen.findByText(company));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("tab", { name: "Resume" }));
  return { user, dialog };
}

describe("resume refine chat", () => {
  it("a suggestion makes a new current version, and the old one can be restored", async () => {
    const { user, dialog } = await openResumeTab("Orchard Pay");

    await user.click(await within(dialog).findByRole("button", { name: "Make it shorter" }));

    expect(await within(dialog).findByText(/kept the two strongest bullets/i)).toBeInTheDocument();
    const picker = await within(dialog).findByLabelText("Resume version");
    expect(within(picker).getByRole("option", { name: /v2 · Refined: Make it shorter \(current\)/ })).toBeInTheDocument();

    // look at v1, then make it current again
    await user.selectOptions(picker, within(picker).getByRole("option", { name: /^v1/ }));
    expect(await within(dialog).findByText(/older version/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Make current" }));
    await waitFor(() => expect(within(dialog).getByText(/Restored version #/)).toBeInTheDocument());
    expect(within(dialog).queryByText(/older version/i)).toBeNull();
  });

  it("typing a request that needs a skill I don't have changes nothing and says why", async () => {
    const { user, dialog } = await openResumeTab("Orchard Pay");

    await user.type(within(dialog).getByLabelText("What should change?"), "Add Kubernetes{Enter}");

    expect(await within(dialog).findByText(/isn't in your resume/i)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Resume version")).toBeNull(); // still only one version
  });

  it("is hidden once the application was sent", async () => {
    const { dialog } = await openResumeTab("Paperplane");
    expect(await within(dialog).findByText(/resume is final/i)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("What should change?")).toBeNull();
  });
});
