import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, toast } = vi.hoisted(() => ({ invoke: vi.fn(), toast: { error: vi.fn() } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@yusufceng1z/ding-react", () => ({ toast }));

import { DEFAULT_SETTINGS, mergeSettings, useSettingsStore } from "./settings-store";

beforeEach(() => {
  invoke.mockReset();
  toast.error.mockReset();
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, restartRequired: false });
});

describe("mergeSettings", () => {
  it("deep-merges one section without touching the others", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { audio: { inputDevice: "USB Mic" } });
    expect(merged.audio).toEqual({ ...DEFAULT_SETTINGS.audio, inputDevice: "USB Mic" });
    expect(merged.audio.routing).toEqual(DEFAULT_SETTINGS.audio.routing);
    expect(merged.recording).toEqual({ autoRecord: true });
    expect(merged.general).toEqual(DEFAULT_SETTINGS.general);
  });
});

describe("update", () => {
  it("applies optimistically, persists and remembers that a restart is required", async () => {
    invoke.mockImplementation(async (_cmd: string, args: { settings: unknown }) => ({
      settings: args.settings,
      restartRequired: true,
    }));
    const ok = await useSettingsStore.getState().update({ network: { localSipPort: 5070 } });
    expect(ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith("update_settings", {
      settings: expect.objectContaining({ network: expect.objectContaining({ localSipPort: 5070 }) }),
    });
    expect(useSettingsStore.getState().settings.network.localSipPort).toBe(5070);
    expect(useSettingsStore.getState().restartRequired).toBe(true);
  });

  it("rolls back and reports when the backend refuses", async () => {
    invoke.mockRejectedValue({ kind: "validation", message: "Port invalide" });
    const ok = await useSettingsStore.getState().update({ network: { localSipPort: 80 } });
    expect(ok).toBe(false);
    expect(useSettingsStore.getState().settings.network.localSipPort).toBeNull();
    expect(toast.error).toHaveBeenCalledWith("Port invalide");
  });
});
