import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, toast } = vi.hoisted(() => ({
  invoke: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@yusufceng1z/ding-react", () => ({ toast }));

import { useAudioStore } from "@/stores/audio-store";
import { DEFAULT_SETTINGS, useSettingsStore } from "@/stores/settings-store";
import { makeBackend } from "@/test/backend";
import type { AudioState, DeviceInfo, Resolution, Role, RoleState } from "@/types/audio";

import { AudioDevices } from "./AudioDevices";

const dev = (uid: string, name: string, transport: DeviceInfo["transport"], i: number, o: number): DeviceInfo => ({
  uid,
  name,
  transport,
  inputChannels: i,
  outputChannels: o,
  alive: true,
  publicSpeaker: transport === "builtIn" && o > 0,
  inUseElsewhere: false,
  selectable: true,
  duplicateName: false,
});

const MIC = dev("mic", "MacBook Pro Microphone", "builtIn", 1, 0);
const SPK = dev("spk", "MacBook Pro Speakers", "builtIn", 0, 2);
const USB = dev("usb", "Jabra Evolve2 65", "usb", 1, 2);

function role(r: Role, over: Partial<RoleState> = {}, resolution: Partial<Resolution> = {}): RoleState {
  const choices = r === "microphone" ? [MIC, USB] : [SPK, USB];
  const used = r === "microphone" ? MIC : SPK;
  return {
    role: r,
    label: r,
    choice: { selection: { kind: "follow", source: "systemDefault" }, fallback: null },
    resolution: { role: r, used, source: "following", problems: [], learnedUid: null, ...resolution },
    inUse: used,
    notice: null,
    refused: null,
    choices,
    ...over,
  };
}

const state = (roles: RoleState[], over: Partial<AudioState> = {}): AudioState => ({
  snapshot: { devices: [MIC, SPK, USB], defaultInput: "mic", defaultOutput: "spk", alertOutput: "spk" },
  roles,
  routing: DEFAULT_SETTINGS.audio.routing,
  inCall: false,
  supportsCommunicationDefault: false,
  ...over,
});

beforeEach(() => {
  invoke.mockReset();
  Object.values(toast).forEach((f) => f.mockReset());
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS });
  makeBackend(invoke, {
    audio_state: () => useAudioStore.getState().state,
    headset_state: () => null,
    update_settings: (a) => ({ settings: a?.settings, restartRequired: false }),
  });
});

const show = (s: AudioState) => {
  useAudioStore.setState({ state: s });
  render(<AudioDevices />);
};

describe("AudioDevices", () => {
  it("shows the three roles apart, each with the device really in use", () => {
    show(state([role("microphone"), role("speaker"), role("ringer")]));
    expect(screen.getByRole("combobox", { name: "Microphone" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Conversation output" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Ringtone" })).toBeInTheDocument();
    expect(within(screen.getByTestId("in-use-microphone")).getByText("MacBook Pro Microphone")).toBeInTheDocument();
    expect(within(screen.getByTestId("in-use-speaker")).getByText("MacBook Pro Speakers")).toBeInTheDocument();
    expect(within(screen.getByTestId("in-use-ringer")).getByText("Follows the system")).toBeInTheDocument();
  });

  it("tells following the system from an explicit headset and from a fallback in use", () => {
    show(
      state([
        role("microphone", {
          choice: {
            selection: { kind: "explicit", device: { uid: "usb", name: "Jabra Evolve2 65" } },
            fallback: { uid: "mic", name: "MacBook Pro Microphone" },
          },
          inUse: USB,
          resolution: { role: "microphone", used: USB, source: "chosen", problems: [], learnedUid: null },
        }),
        role("speaker", {
          choice: {
            selection: { kind: "explicit", device: { uid: "gone", name: "Desk headset" } },
            fallback: { uid: "spk", name: "MacBook Pro Speakers" },
          },
          resolution: {
            role: "speaker",
            used: SPK,
            source: "fallback",
            problems: [{ kind: "chosenUnavailable", name: "Desk headset" }],
            learnedUid: null,
          },
        }),
        role("ringer"),
      ]),
    );
    expect(within(screen.getByTestId("in-use-microphone")).getByText("Explicit choice")).toBeInTheDocument();
    expect(within(screen.getByTestId("in-use-speaker")).getByText("Backup device")).toBeInTheDocument();
    expect(within(screen.getByTestId("in-use-ringer")).getByText("Follows the system")).toBeInTheDocument();
    // The fallback choice is only offered for an explicit one.
    expect(screen.getAllByRole("combobox", { name: /Backup device/ })).toHaveLength(2);
  });

  it("says a saved choice is unplugged, and that it will be used again when it returns", () => {
    show(
      state([
        role("microphone"),
        role(
          "speaker",
          {
            choice: {
              selection: { kind: "explicit", device: { uid: "gone", name: "Desk headset" } },
              fallback: null,
            },
          },
          {
            source: "systemInstead",
            problems: [{ kind: "chosenUnavailable", name: "Desk headset" }],
          },
        ),
        role("ringer"),
      ]),
    );
    expect(
      screen.getByText(/“Desk headset” is not plugged in: it will be used again as soon as it returns/),
    ).toBeInTheDocument();
    expect(within(screen.getByTestId("in-use-speaker")).getByText(/System default/)).toBeInTheDocument();
  });

  it("shows the device the engine really uses when it differs from the one asked, with the refusal", () => {
    show(
      state([
        role("microphone"),
        role("speaker", { inUse: SPK, refused: "unknown device" }, { used: USB, source: "following" }),
        role("ringer"),
      ]),
    );
    expect(
      screen.getByText(
        /This choice should use “Jabra Evolve2 65”, but the audio engine is still using “MacBook Pro Speakers”: unknown device/,
      ),
    ).toBeInTheDocument();
    expect(within(screen.getByTestId("in-use-speaker")).getByText("MacBook Pro Speakers")).toBeInTheDocument();
  });

  it("explains the Bluetooth microphone constraint as the system's, not the app's", () => {
    const bt = dev("bt", "AirPods", "bluetooth", 1, 2);
    show(state([role("microphone", { inUse: bt }), role("speaker"), role("ringer")]));
    expect(screen.getByText(/Bluetooth constraint, not a ZePhone setting/)).toBeInTheDocument();
  });

  it("is honest that macOS has no separate communication device", () => {
    show(state([role("microphone"), role("speaker"), role("ringer")]));
    expect(screen.getByText(/macOS has no “communication” device/)).toBeInTheDocument();
  });

  it("saves the policy and the loudspeaker permission as part of the routing", async () => {
    show(state([role("microphone"), role("speaker"), role("ringer")]));
    expect(screen.getByRole("switch", { name: /automatic switching to loudspeakers/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole("switch", { name: /automatic switching to loudspeakers/ }));
    await waitFor(() => expect(invoke.mock.calls.some((c) => c[0] === "update_settings")).toBe(true));
    const sent = invoke.mock.calls.find((c) => c[0] === "update_settings")?.[1] as {
      settings: { audio: { routing: { allowPublicSpeaker: boolean; lostPolicy: string } } };
    };
    expect(sent.settings.audio.routing.allowPublicSpeaker).toBe(true);
    expect(sent.settings.audio.routing.lostPolicy).toBe("useFallback");
  });
});
