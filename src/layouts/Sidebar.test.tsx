import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { useCallsStore } from "@/stores/calls-store";
import { useUiStore } from "@/stores/ui-store";
import { makeCall } from "@/test/fixtures";

import { Sidebar } from "./Sidebar";

beforeEach(() => {
  useCallsStore.setState({ calls: {}, dialing: false });
  useUiStore.setState({ section: "settings" });
});

describe("Sidebar", () => {
  it("has no 'Appels' tab: the call lives on the keypad page", () => {
    render(<Sidebar />);
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual(expect.arrayContaining(["Clavier", "Contacts", "Historique", "Paramètres"]));
    expect(names).not.toContain("Appels");
  });

  it("the logo is the voice orb and brings back the keypad page", () => {
    render(<Sidebar />);
    const orb = screen.getByTestId("sidebar-orb");
    expect(orb.querySelector("canvas")).not.toBeNull();
    expect(orb).toHaveAttribute("data-in-call", "false");
    fireEvent.click(orb);
    expect(useUiStore.getState().section).toBe("dialer");
  });

  it("follows the call in progress", () => {
    useCallsStore.setState({ calls: { call1: makeCall({ state: "connected" }) } });
    render(<Sidebar />);
    expect(screen.getByTestId("sidebar-orb")).toHaveAttribute("data-in-call", "true");
  });
});
