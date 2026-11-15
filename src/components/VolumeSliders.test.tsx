import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@yusufceng1z/ding-react", () => ({ toast: { error: vi.fn() } }));

import { VolumeSliders } from "@/components/VolumeSliders";
import { DEFAULT_SETTINGS, useSettingsStore } from "@/stores/settings-store";

const incoming = () => screen.getByRole("slider", { name: /son entrant/i });
const outgoing = () => screen.getByRole("slider", { name: /son sortant/i });

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (cmd: string, args: { settings?: unknown }) =>
    cmd === "update_settings" ? { settings: args.settings, restartRequired: false } : undefined,
  );
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS });
});

describe("VolumeSliders", () => {
  it("has an incoming and an outgoing volume, at 100 % by default", () => {
    render(<VolumeSliders />);
    expect(incoming()).toHaveValue("100");
    expect(outgoing()).toHaveValue("100");
  });

  it("shows the saved volumes", () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, audio: { ...DEFAULT_SETTINGS.audio, inputGain: 60, outputGain: 150 } },
    });
    render(<VolumeSliders />);
    expect(incoming()).toHaveValue("150");
    expect(outgoing()).toHaveValue("60");
  });

  it("changes the sound of the call at once and saves the volume when released", async () => {
    render(<VolumeSliders />);
    fireEvent.keyDown(incoming(), { key: "ArrowRight" });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("set_audio_gains", { input: 100, output: 101 }));
    await waitFor(() => expect(useSettingsStore.getState().settings.audio.outputGain).toBe(101));
    expect(invoke).toHaveBeenCalledWith("update_settings", {
      settings: expect.objectContaining({ audio: expect.objectContaining({ outputGain: 101, inputGain: 100 }) }),
    });

    fireEvent.keyDown(outgoing(), { key: "ArrowLeft" });
    await waitFor(() => expect(useSettingsStore.getState().settings.audio.inputGain).toBe(99));
    expect(invoke).toHaveBeenCalledWith("set_audio_gains", { input: 99, output: 101 });
  });

  it("follows volumes saved elsewhere (another window)", () => {
    render(<VolumeSliders />);
    act(() =>
      useSettingsStore.getState().adopt({
        ...DEFAULT_SETTINGS,
        audio: { ...DEFAULT_SETTINGS.audio, outputGain: 30 },
      }),
    );
    expect(incoming()).toHaveValue("30");
  });
});
