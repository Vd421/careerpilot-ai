import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "@/test/utils";
import { emptyDraft, validateStep, toInput } from "@/components/loops/LoopForm";
import { validateSettings } from "./Settings";

describe("loop form validation rules", () => {
  it("requires name, keywords, locations and a source", () => {
    expect(validateStep(0, emptyDraft).name).toBeTruthy();
    const e = validateStep(1, emptyDraft);
    expect(e.keywords && e.locations && e.sources).toBeTruthy();
    expect(validateStep(2, { ...emptyDraft, minScore: "150" }).minScore).toBeTruthy();
    expect(validateStep(3, { ...emptyDraft, resumeVariantIds: [1, 2, 3] }).resumeVariantIds).toBeTruthy();
    expect(Object.keys(validateStep(0, { ...emptyDraft, name: "A loop" }))).toHaveLength(0);
  });
  it("builds a contract-shaped LoopInput", () => {
    const input = toInput({ ...emptyDraft, name: " X ", keywords: ["a"], locations: ["Remote"], sources: ["remotive"], usdFloor: "30000" });
    expect(input.name).toBe("X");
    expect(input.filters.salaryFloors).toEqual({ USD: 30000 });
  });
});

describe("new loop form", () => {
  it("blocks each step until valid, then creates the loop", async () => {
    const user = userEvent.setup();
    renderApp("/loops");
    await screen.findByText("India full stack");
    await user.click(screen.getByRole("button", { name: /new loop/i }));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(await within(dialog).findByText("Give the loop a name.")).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText("Name"), "Test loop");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(await within(dialog).findByText("Add at least one keyword.")).toBeInTheDocument();
    expect(within(dialog).getByText("Pick at least one source.")).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText("Keywords"), "react{Enter}");
    await user.type(within(dialog).getByLabelText("Locations"), "Remote{Enter}");
    await user.click(await within(dialog).findByRole("checkbox", { name: "Remotive" }));
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    await user.click(within(dialog).getByRole("button", { name: "Create loop" }));
    expect(await screen.findByRole("heading", { name: "Test loop" })).toBeInTheDocument();
  });
});

describe("loops list", () => {
  it("toggles a loop on and off optimistically", async () => {
    const user = userEvent.setup();
    renderApp("/loops");
    const sw = await screen.findByRole("switch", { name: /India full stack loop on or off/i });
    expect(sw).toBeChecked();
    await user.click(sw);
    await waitFor(() => expect(screen.getByRole("switch", { name: /India full stack/i })).not.toBeChecked());
  });

  it("detail shows variant sample sizes", async () => {
    renderApp("/loops/2");
    expect(await screen.findByText(/n = 5/)).toBeInTheDocument();
    expect(screen.getByText(/Sample sizes are small/)).toBeInTheDocument();
  });
});

describe("settings", () => {
  it("turning DRY_RUN off needs a confirmation", async () => {
    const user = userEvent.setup();
    renderApp("/settings");
    const sw = await screen.findByRole("switch", { name: "Dry run" });
    expect(sw).toBeChecked();

    await user.click(sw);
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Real applications will be submitted after you approve them on Telegram/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByRole("switch", { name: "Dry run" })).toBeChecked();

    await user.click(screen.getByRole("switch", { name: "Dry run" }));
    await user.click(await within(await screen.findByRole("alertdialog")).findByRole("button", { name: "Turn off dry run" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Dry run" })).not.toBeChecked());
  });

  it("turning dry run back on needs no confirmation", async () => {
    const user = userEvent.setup();
    renderApp("/settings");
    await user.click(await screen.findByRole("switch", { name: "Dry run" }));
    await user.click(await within(await screen.findByRole("alertdialog")).findByRole("button", { name: "Turn off dry run" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Dry run" })).not.toBeChecked());
    await user.click(screen.getByRole("switch", { name: "Dry run" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Dry run" })).toBeChecked());
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("caps the daily limit at 15 and disables unconfigured sources", async () => {
    const user = userEvent.setup();
    expect(validateSettings({ floors: {}, noticeDays: "60", matchThreshold: "75", maxYearsRequired: "3", dailyCap: "16" }).dailyCap).toMatch(/15/);
    renderApp("/settings");
    expect(await screen.findByRole("switch", { name: "JSearch source" })).toBeDisabled();
    expect(screen.getAllByText("Not configured").length).toBeGreaterThan(0);
    const cap = screen.getByLabelText("Daily cap");
    await user.clear(cap);
    await user.type(cap, "20");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText(/hard maximum/i, { selector: "p[role=alert]" })).toBeInTheDocument();
  });
});
