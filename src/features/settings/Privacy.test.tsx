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
  it("is shown at the first launch, with both on", () => {
    render(<DiagnosticsPrompt />);
    expect(screen.getByText("Help improve ZePhone")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Send crash reports" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Share anonymous usage statistics" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("is not shown again once validated, nor before the settings are loaded", () => {
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

  it("keeps both on when it is just continued", async () => {
    render(<DiagnosticsPrompt />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(saved()).toEqual([{ crashReports: true, usageStats: true, answered: true }]));
  });

  it("saves what was switched off", async () => {
    render(<DiagnosticsPrompt />);
    fireEvent.click(screen.getByRole("switch", { name: "Send crash reports" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(saved()).toEqual([{ crashReports: false, usageStats: true, answered: true }]));
  });

  it("keeps what the switches show when the window is closed", async () => {
    render(<DiagnosticsPrompt />);
    fireEvent.click(screen.getByRole("switch", { name: "Share anonymous usage statistics" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(saved()).toEqual([{ crashReports: true, usageStats: false, answered: true }]));
  });
});

describe("PrivacySettings", () => {
  it("turns each service off by itself", async () => {
    render(<PrivacySettings />);
    fireEvent.click(screen.getByRole("switch", { name: "Share anonymous usage statistics" }));
    await waitFor(() => expect(saved()).toEqual([{ crashReports: true, usageStats: false, answered: true }]));
  });

  it("resets the anonymous identifier", async () => {
    render(<PrivacySettings />);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("telemetry_reset_id", undefined));
  });
});
