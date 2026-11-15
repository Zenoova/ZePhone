import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@yusufceng1z/ding-react", () => ({ toast: { error: vi.fn() } }));

import { DEFAULT_SETTINGS, useSettingsStore } from "@/stores/settings-store";

import { AudioSettings } from "./AudioSettings";

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (cmd: string, args: { settings?: unknown }) => {
    if (cmd === "update_settings") return { settings: args.settings, restartRequired: false };
    if (cmd === "list_audio_devices") return { inputs: [], outputs: [] };
    if (cmd === "get_microphone_permission") return "authorized";
    return undefined;
  });
  useSettingsStore.setState({
    settings: DEFAULT_SETTINGS,
    devices: { inputs: [], outputs: [] },
    micPermission: "authorized",
  });
});

describe("AudioSettings", () => {
  it("has the incoming and outgoing volumes", () => {
    render(<AudioSettings />);
    expect(screen.getByRole("slider", { name: /son entrant/i })).toHaveValue("100");
    expect(screen.getByRole("slider", { name: /son sortant/i })).toHaveValue("100");
  });

  it("records every call only when asked to, and says it stays on this Mac", async () => {
    render(<AudioSettings />);
    expect(screen.getByText(/restent sur ce Mac/)).toBeInTheDocument();
    const toggle = screen.getByRole("switch", { name: "Enregistrer tous les appels" });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => expect(useSettingsStore.getState().settings.recording.autoRecord).toBe(true));
    expect(invoke).toHaveBeenCalledWith("update_settings", {
      settings: expect.objectContaining({ recording: { autoRecord: true } }),
    });
  });
});
