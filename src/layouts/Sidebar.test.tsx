import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { useCallsStore } from "@/stores/calls-store";
import { DEFAULT_SETTINGS, useSettingsStore } from "@/stores/settings-store";
import { useUiStore } from "@/stores/ui-store";
import { makeCall } from "@/test/fixtures";

import { Sidebar } from "./Sidebar";

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (_cmd: string, args: { settings: unknown }) => ({
    settings: args.settings,
    restartRequired: false,
  }));
  useCallsStore.setState({ calls: {}, dialing: false });
  useUiStore.setState({ section: "settings" });
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS });
});

describe("Sidebar", () => {
  it("has no 'Appels' tab: the call lives on the keypad page", () => {
    render(<Sidebar />);
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual(expect.arrayContaining(["Clavier", "Contacts", "Historique", "Paramètres"]));
    expect(names).not.toContain("Appels");
  });

  it("the logo is the voice orb and opens the choice of the orb", async () => {
    render(<Sidebar />);
    const orb = screen.getByTestId("sidebar-orb");
    await waitFor(() => expect(orb.querySelector("[data-orb=shdr-32]")).not.toBeNull()); // the default orb
    expect(orb).toHaveAttribute("data-in-call", "false");
    fireEvent.click(orb);
    expect(await screen.findByRole("radiogroup", { name: "Orbe vocal" })).toBeInTheDocument();
    expect(useUiStore.getState().section).toBe("settings"); // it no longer navigates
  });

  it("can still show the classic bubble", () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, general: { ...DEFAULT_SETTINGS.general, voiceOrb: "classic" } },
    });
    render(<Sidebar />);
    expect(screen.getByTestId("sidebar-orb").querySelector("canvas")).not.toBeNull();
    expect(screen.getByTestId("sidebar-orb").querySelector("[data-orb]")).toBeNull();
  });

  it("picking an orb is applied to the logo and saved", async () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByTestId("sidebar-orb"));
    fireEvent.click(await screen.findByRole("radio", { name: "Plasma" }));
    expect(invoke).toHaveBeenCalledWith("update_settings", {
      settings: expect.objectContaining({ general: expect.objectContaining({ voiceOrb: "shdr-13" }) }),
    });
    await waitFor(() => expect(screen.getByTestId("sidebar-orb").querySelector("[data-orb=shdr-13]")).not.toBeNull());
    expect(useSettingsStore.getState().settings.general.voiceOrb).toBe("shdr-13");
  });

  it("follows the call in progress", () => {
    useCallsStore.setState({ calls: { call1: makeCall({ state: "connected" }) } });
    render(<Sidebar />);
    expect(screen.getByTestId("sidebar-orb")).toHaveAttribute("data-in-call", "true");
  });
});
