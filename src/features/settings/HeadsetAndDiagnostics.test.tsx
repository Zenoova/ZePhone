import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import type { AudioState, DeviceInfo, HeadsetState, RoleState } from "@/types/audio";

import { AudioDiagnostics } from "./AudioDiagnostics";
import { HeadsetButtons } from "./HeadsetButtons";

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
const USB = { ...dev("usb", "Jabra Evolve2 65", "usb", 1, 2), inUseElsewhere: true };

const role = (r: "microphone" | "speaker" | "ringer", used: DeviceInfo): RoleState => ({
  role: r,
  label: r,
  choice: { selection: { kind: "follow", source: "systemDefault" }, fallback: null },
  resolution: { role: r, used, source: "following", problems: [], learnedUid: null },
  inUse: used,
  notice: null,
  refused: null,
  choices: [used],
});
const audio = (inCall = false): AudioState => ({
  snapshot: { devices: [MIC, SPK, USB], defaultInput: "usb", defaultOutput: "usb", alertOutput: "spk" },
  roles: [role("microphone", USB), role("speaker", USB), role("ringer", SPK)],
  routing: DEFAULT_SETTINGS.audio.routing,
  inCall,
  supportsCommunicationDefault: false,
});
const headsetState = (over: Partial<HeadsetState> = {}): HeadsetState => ({
  settings: DEFAULT_SETTINGS.audio.headset,
  reading: { kind: "listening" },
  devices: [],
  log: [],
  vendorAvailable: false,
  ...over,
});

let backend: ReturnType<typeof makeBackend>;
beforeEach(() => {
  invoke.mockReset();
  Object.values(toast).forEach((f) => f.mockReset());
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, micPermission: "authorized" });
  useAudioStore.setState({ state: audio(), headset: headsetState(), level: null, metering: false });
  backend = makeBackend(invoke, {
    audio_state: () => audio(),
    headset_state: () => headsetState(),
    audio_test: () => undefined,
    audio_meter: () => undefined,
    update_settings: (a) => ({ settings: a?.settings, restartRequired: false }),
  });
});

describe("HeadsetButtons", () => {
  it("separates the buttons from the audio, with the limits stated plainly", () => {
    render(<HeadsetButtons />);
    expect(screen.getByRole("combobox", { name: "Headset button handling" })).toHaveTextContent("Automatic");
    expect(screen.getByText(/ZePhone only acts on the buttons if it has a call itself/)).toBeInTheDocument();
    expect(screen.getByText(/does not take over the buttons/i)).toBeInTheDocument();
    expect(screen.getByText(/can neither control nor observe it/)).toBeInTheDocument();
  });

  it("turns each action off on its own, keeping the rest of the settings", async () => {
    render(<HeadsetButtons />);
    fireEvent.click(screen.getByRole("switch", { name: "Mute the microphone with the headset" }));
    await waitFor(() => expect(backend.calls("update_settings")).toHaveLength(1));
    const sent = backend.calls("update_settings")[0] as { settings: { audio: { headset: Record<string, unknown> } } };
    expect(sent.settings.audio.headset).toMatchObject({ mute: false, answer: true, hangUp: true, mode: "auto" });
  });

  it("with the buttons disabled, the actions cannot be toggled (the audio is not concerned)", () => {
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        audio: { ...DEFAULT_SETTINGS.audio, headset: { ...DEFAULT_SETTINGS.audio.headset, mode: "off" } },
      },
    });
    render(<HeadsetButtons />);
    for (const name of [
      "Answer with the headset",
      "Hang up with the headset",
      "Mute the microphone with the headset",
      "Hold with the headset",
    ]) {
      expect(screen.getByRole("switch", { name })).toBeDisabled();
    }
  });
});

describe("AudioDiagnostics", () => {
  const open = () => render(<AudioDiagnostics open onOpenChange={vi.fn()} />);

  it("lists the devices detected and which ones are really used, and for what", () => {
    open();
    const devices = screen.getAllByTestId("diag-device");
    expect(devices).toHaveLength(3);
    const usb = devices.find((d) => d.textContent?.includes("Jabra"))!;
    expect(within(usb).getByText("USB")).toBeInTheDocument();
    expect(within(usb).getByText("In use: Microphone")).toBeInTheDocument();
    expect(within(usb).getByText("In use: Conversation output")).toBeInTheDocument();
    expect(within(usb).getByText("Used by an application")).toBeInTheDocument();
    const spk = devices.find((d) => d.textContent?.includes("Speakers"))!;
    expect(within(spk).getByText("Public speaker")).toBeInTheDocument();
    expect(within(spk).getByText("In use: Ringtone")).toBeInTheDocument();
  });

  it("identifies a missing microphone permission, with a way to fix it", () => {
    useSettingsStore.setState({ micPermission: "denied" });
    open();
    expect(screen.getByTestId("diag-mic-permission")).toHaveTextContent("Denied");
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    expect(backend.calls("open_microphone_settings")).toHaveLength(1);
  });

  it("tests are started on purpose, one action each", async () => {
    open();
    expect(backend.calls("audio_test")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Test the output" }));
    await waitFor(() => expect(backend.calls("audio_test")).toHaveLength(1));
    expect(backend.calls("audio_test")[0]).toEqual({ kind: "speaker" });
    fireEvent.click(screen.getByRole("button", { name: "Test the ringtone" }));
    await waitFor(() => expect(backend.calls("audio_test")).toHaveLength(2));
    expect(backend.calls("audio_test")[1]).toEqual({ kind: "ringtone" });
  });

  it("disables every test during a call and says why, so a call is never disturbed", () => {
    useAudioStore.setState({ state: audio(true) });
    open();
    expect(screen.getByText(/A call is in progress: the tests are disabled/)).toBeInTheDocument();
    for (const name of ["Test the output", "Test the ringtone", "See the microphone level"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
  });

  it("shows the microphone level while the test runs, and stops it", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "See the microphone level" }));
    await waitFor(() => expect(backend.calls("audio_meter")[0]).toEqual({ on: true }));
    act(() => useAudioStore.getState().pushLevel(-20));
    const meter = await screen.findByRole("meter", { name: "Microphone level" });
    expect(meter).toHaveAttribute("aria-valuenow", "-20");
    fireEvent.click(screen.getByRole("button", { name: "Stop the microphone level" }));
    await waitFor(() => expect(backend.calls("audio_meter").at(-1)).toEqual({ on: false }));
  });

  it("says whether the headset commands are read, which buttons each headset declares, and what became of the last events", () => {
    useAudioStore.setState({
      headset: headsetState({
        devices: [
          {
            id: "j",
            product: "Jabra Evolve2 65",
            manufacturer: "GN Audio",
            transport: "USB",
            buttons: ["hookSwitch", "phoneMute"],
            inUse: true,
          },
          { id: "o", product: "Other Headset", manufacturer: "", transport: "Bluetooth", buttons: [], inUse: false },
        ],
        log: [
          {
            at: "2026-01-01T10:00:00Z",
            device: "Jabra",
            button: "Mute the microphone",
            value: 0,
            result: "Muted (done)",
            acted: true,
          },
          {
            at: "2026-01-01T10:00:05Z",
            device: "Jabra",
            button: "Answer / hang up",
            value: 1,
            result: "No incoming call to answer",
            acted: false,
          },
        ],
      }),
    });
    open();
    expect(screen.getByTestId("diag-headset-reading")).toHaveTextContent("Reading of the headset commands is active");
    const [jabra, other] = screen.getAllByTestId("diag-headset-device");
    expect(jabra).toHaveTextContent("Answer / hang up, Mute the microphone");
    expect(jabra).toHaveTextContent("Commands enabled");
    expect(jabra).toHaveTextContent("Headset in use");
    expect(other).toHaveTextContent("no standard telephony button");
    expect(other).toHaveTextContent("Not the one ZePhone uses");
    const log = screen.getByLabelText("Latest headset events");
    expect(log).toHaveTextContent("Muted (done)");
    expect(log).toHaveTextContent("No incoming call to answer");
  });

  it("explains a refused HID permission and that the audio itself still works", () => {
    useAudioStore.setState({ headset: headsetState({ reading: { kind: "permissionNeeded" } }) });
    open();
    expect(screen.getByTestId("diag-headset-reading")).toHaveTextContent("macOS asks for a permission");
    expect(screen.getByText(/the headset audio works, but not its buttons/)).toBeInTheDocument();
  });

  it("does not claim a headset supports its buttons just because it is connected", () => {
    open();
    expect(screen.getByText(/No headset exposes standard telephony commands/)).toBeInTheDocument();
  });

  it("names the commands as disabled when the buttons are off", () => {
    useAudioStore.setState({
      headset: headsetState({
        settings: { ...DEFAULT_SETTINGS.audio.headset, mode: "off" },
        devices: [
          { id: "j", product: "Jabra", manufacturer: "", transport: "USB", buttons: ["hookSwitch"], inUse: true },
        ],
      }),
    });
    open();
    expect(screen.getByTestId("diag-headset-device")).toHaveTextContent("Commands disabled");
  });
});
