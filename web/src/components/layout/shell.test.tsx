import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "@/test/utils";
import { SIDEBAR_KEY } from "./Sidebar";

describe("sidebar", () => {
  it("collapses to the icon rail and remembers it", async () => {
    const user = userEvent.setup();
    renderApp("/");
    const sidebar = screen.getByTestId("sidebar");
    expect(sidebar).toHaveAttribute("data-collapsed", "false");

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(sidebar).toHaveAttribute("data-collapsed", "true");
    expect(window.localStorage.getItem(SIDEBAR_KEY)).toBe("true");
    // Nav stays reachable by name while collapsed.
    expect(screen.getByRole("link", { name: "Jobs" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(sidebar).toHaveAttribute("data-collapsed", "false");
  });

  it("lists recent jobs one line each", async () => {
    renderApp("/");
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Northwind Labs/ }).length).toBeGreaterThan(0));
  });
});

describe("command palette", () => {
  it("opens with Ctrl+K and finds a job", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await user.keyboard("{Control>}k{/Control}");
    const input = await screen.findByPlaceholderText(/Search jobs/);
    await user.type(input, "cobalt");
    expect(await screen.findByText("Cobalt Robotics")).toBeInTheDocument();
  });
});

describe("new job dialog", () => {
  it("asks for a JD or URL before submitting", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await user.click(screen.getByRole("button", { name: "New job" }));
    await user.click(await screen.findByRole("button", { name: "Add and score" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Paste a job description or a URL/);
  });
});
