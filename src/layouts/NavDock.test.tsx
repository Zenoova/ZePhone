import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@yusufceng1z/ding-react", () => ({ toast: { error: vi.fn() } }));

import { useCallsStore } from "@/stores/calls-store";
import { useHistoryStore } from "@/stores/history-store";
import { DEFAULT_SETTINGS, useSettingsStore } from "@/stores/settings-store";
import { useUiStore } from "@/stores/ui-store";
import { makeCall, makeHistory } from "@/test/fixtures";

import { NavDock } from "./NavDock";

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (_cmd: string, args: { settings: unknown }) => ({
    settings: args.settings,
    restartRequired: false,
  }));
  useCallsStore.setState({ calls: {}, dialing: false });
  useUiStore.setState({ section: "settings" });
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS });
  useHistoryStore.setState({ entries: [], seenAt: "" });
});

describe("NavDock", () => {
  it("is the main navigation, with no 'Appels' tab: the call lives on the keypad page", () => {
    render(<NavDock />);
    const nav = screen.getByRole("navigation", { name: "Navigation principale" });
    const names = within(nav)
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual([
      "Choisir l'orbe vocal",
      "Clavier",
      "Contacts",
      "Historique",
      "Enregistrements",
      "Paramètres",
    ]);
  });

  it("goes to a page when its icon is clicked, and marks the page being shown", () => {
    render(<NavDock />);
    expect(screen.getByRole("button", { name: "Paramètres" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Contacts" })).not.toHaveAttribute("aria-current");
    fireEvent.click(screen.getByRole("button", { name: "Contacts" }));
    expect(useUiStore.getState().section).toBe("contacts");
    expect(screen.getByRole("button", { name: "Contacts" })).toHaveAttribute("aria-current", "page");
  });

  it("tells how many missed calls are waiting on the history icon", () => {
    useHistoryStore.setState({
      entries: [
        makeHistory({ id: "h1", result: "missed", endedAt: "2026-01-02T10:00:08.000Z" }),
        makeHistory({ id: "h2", result: "missed", endedAt: "2026-01-02T11:00:08.000Z" }),
      ],
      seenAt: "2026-01-01T00:00:00.000Z",
    });
    render(<NavDock />);
    expect(screen.getByRole("button", { name: "Historique (2 en attente)" })).toBeInTheDocument();
  });

  it("the first icon of the dock is the voice orb and opens the carousel of orbs", async () => {
    render(<NavDock />);
    const orb = screen.getByTestId("dock-orb");
    await waitFor(() => expect(orb.querySelector("[data-orb=shdr-32]")).not.toBeNull()); // the default orb
    expect(orb).toHaveAttribute("data-in-call", "false");
    fireEvent.click(orb);
    expect(await screen.findByRole("radiogroup", { name: "Voice orb" })).toBeInTheDocument();
    expect(screen.getByTestId("orb-name")).toHaveTextContent("Galaxy");
    expect(useUiStore.getState().section).toBe("settings"); // it no longer navigates
  });

  it("falls back to the default orb when the saved one is retired", async () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, general: { ...DEFAULT_SETTINGS.general, voiceOrb: "classic" } },
    });
    render(<NavDock />);
    await waitFor(() => expect(screen.getByTestId("dock-orb").querySelector("[data-orb=shdr-32]")).not.toBeNull());
  });

  it("the orb picked in the carousel is applied to the dock icon and saved", async () => {
    render(<NavDock />);
    fireEvent.click(screen.getByTestId("dock-orb"));
    const group = await screen.findByRole("radiogroup", { name: "Voice orb" });
    fireEvent.keyDown(group, { key: "ArrowLeft" }); // Galaxy -> Plasma
    await waitFor(() => expect(useSettingsStore.getState().settings.general.voiceOrb).toBe("shdr-13"));
    expect(invoke).toHaveBeenCalledWith("update_settings", {
      settings: expect.objectContaining({ general: expect.objectContaining({ voiceOrb: "shdr-13" }) }),
    });
    await waitFor(() => expect(screen.getByTestId("dock-orb").querySelector("[data-orb=shdr-13]")).not.toBeNull());
  });

  it("follows the call in progress", () => {
    useCallsStore.setState({ calls: { call1: makeCall({ state: "connected" }) } });
    render(<NavDock />);
    expect(screen.getByTestId("dock-orb")).toHaveAttribute("data-in-call", "true");
  });
});
