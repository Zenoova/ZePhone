import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(async (command: string, args?: unknown): Promise<unknown> => {
    if (command === "update_settings")
      return { settings: (args as { settings: unknown }).settings, restartRequired: false };
    return undefined;
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@yusufceng1z/ding-react", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { DEFAULT_SETTINGS, useSettingsStore } from "@/stores/settings-store";

import { DiagnosticsPrompt } from "./DiagnosticsPrompt";
import { PrivacySettings } from "./PrivacySettings";

const saved = () =>
  invoke.mock.calls
    .filter(([c]) => c === "update_settings")
    .map(([, a]) => (a as { settings: { privacy: unknown } }).settings.privacy);

beforeEach(() => {
  invoke.mockClear();
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, loaded: true });
});

describe("DiagnosticsPrompt", () => {
  it("is asked at the first launch, with both choices off", () => {
    render(<DiagnosticsPrompt />);
    expect(screen.getByText("Help improve ZePhone")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Send crash reports" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "Share anonymous usage statistics" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("is not asked again once answered, nor before the settings are loaded", () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, privacy: { crashReports: false, usageStats: false, answered: true } },
    });
    const { unmount } = render(<DiagnosticsPrompt />);
    expect(screen.queryByText("Help improve ZePhone")).toBeNull();
    unmount();
    useSettingsStore.setState({ settings: DEFAULT_SETTINGS, loaded: false });
    render(<DiagnosticsPrompt />);
    expect(screen.queryByText("Help improve ZePhone")).toBeNull();
  });

  it("saves only what was switched on", async () => {
    render(<DiagnosticsPrompt />);
    fireEvent.click(screen.getByRole("switch", { name: "Send crash reports" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saved()).toEqual([{ crashReports: true, usageStats: false, answered: true }]));
  });

  it("counts closing the window as a no", async () => {
    render(<DiagnosticsPrompt />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(saved()).toEqual([{ crashReports: false, usageStats: false, answered: true }]));
  });
});

describe("PrivacySettings", () => {
  it("turns each service on by itself and remembers the question was answered", async () => {
    render(<PrivacySettings />);
    fireEvent.click(screen.getByRole("switch", { name: "Share anonymous usage statistics" }));
    await waitFor(() => expect(saved()).toEqual([{ crashReports: false, usageStats: true, answered: true }]));
  });

  it("resets the anonymous identifier", async () => {
    render(<PrivacySettings />);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("telemetry_reset_id", undefined));
  });
});
