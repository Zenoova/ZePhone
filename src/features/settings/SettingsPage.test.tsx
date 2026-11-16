import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@yusufceng1z/ding-react", () => ({ toast: { error: vi.fn() } }));

import { DEFAULT_SETTINGS, useSettingsStore } from "@/stores/settings-store";
import { useUiStore } from "@/stores/ui-store";

import { SettingsPage } from "./SettingsPage";

beforeEach(() => {
  useUiStore.setState({ section: "settings", settingsTab: "audio" });
  useSettingsStore.setState({
    settings: DEFAULT_SETTINGS,
    devices: { inputs: [], outputs: [] },
    micPermission: "authorized",
  });
});

describe("SettingsPage", () => {
  it("uses the same tabs as the history page, without the accounts (they have a page of their own)", () => {
    render(<SettingsPage />);
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Comptes SIP", "Audio", "Réseau", "Notifications", "Général", "À propos"]);
    expect(screen.getByRole("tab", { name: "Audio" })).toHaveAttribute("data-state", "active");
  });

  it("shows the category that was picked", () => {
    render(<SettingsPage />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Notifications" }), { button: 0 });
    expect(useUiStore.getState().settingsTab).toBe("notifications");
    fireEvent.click(screen.getByRole("tab", { name: "Notifications" }));
    expect(screen.getByRole("switch", { name: "Sonnerie" })).toBeInTheDocument();
  });
});
