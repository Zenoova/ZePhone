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
    expect(screen.getByRole("combobox", { name: "Gestion des boutons du casque" })).toHaveTextContent("Automatique");
    expect(screen.getByText(/ZePhone n'agit sur les boutons que s'il a lui-même un appel/)).toBeInTheDocument();
    expect(screen.getByText(/il n'accapare pas les boutons/i)).toBeInTheDocument();
    expect(screen.getByText(/ne peut ni la commander ni l'observer/)).toBeInTheDocument();
  });

  it("turns each action off on its own, keeping the rest of the settings", async () => {
    render(<HeadsetButtons />);
    fireEvent.click(screen.getByRole("switch", { name: "Couper le micro avec le casque" }));
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
      "Décrocher avec le casque",
      "Raccrocher avec le casque",
      "Couper le micro avec le casque",
      "Attente avec le casque",
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
    expect(within(usb).getByText("Utilisé : Microphone")).toBeInTheDocument();
    expect(within(usb).getByText("Utilisé : Sortie des conversations")).toBeInTheDocument();
    expect(within(usb).getByText("Utilisé par une application")).toBeInTheDocument();
    const spk = devices.find((d) => d.textContent?.includes("Speakers"))!;
    expect(within(spk).getByText("Haut-parleur public")).toBeInTheDocument();
    expect(within(spk).getByText("Utilisé : Sonnerie")).toBeInTheDocument();
  });

  it("identifies a missing microphone permission, with a way to fix it", () => {
    useSettingsStore.setState({ micPermission: "denied" });
    open();
    expect(screen.getByTestId("diag-mic-permission")).toHaveTextContent("Refusée");
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir les réglages" }));
    expect(backend.calls("open_microphone_settings")).toHaveLength(1);
  });

  it("tests are started on purpose, one action each", async () => {
    open();
    expect(backend.calls("audio_test")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Tester la sortie" }));
    await waitFor(() => expect(backend.calls("audio_test")).toHaveLength(1));
    expect(backend.calls("audio_test")[0]).toEqual({ kind: "speaker" });
    fireEvent.click(screen.getByRole("button", { name: "Tester la sonnerie" }));
    await waitFor(() => expect(backend.calls("audio_test")).toHaveLength(2));
    expect(backend.calls("audio_test")[1]).toEqual({ kind: "ringtone" });
  });

  it("disables every test during a call and says why, so a call is never disturbed", () => {
    useAudioStore.setState({ state: audio(true) });
    open();
    expect(screen.getByText(/Un appel est en cours : les tests sont désactivés/)).toBeInTheDocument();
    for (const name of ["Tester la sortie", "Tester la sonnerie", "Voir le niveau du micro"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
  });

  it("shows the microphone level while the test runs, and stops it", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Voir le niveau du micro" }));
    await waitFor(() => expect(backend.calls("audio_meter")[0]).toEqual({ on: true }));
    act(() => useAudioStore.getState().pushLevel(-20));
    const meter = await screen.findByRole("meter", { name: "Niveau du microphone" });
    expect(meter).toHaveAttribute("aria-valuenow", "-20");
    fireEvent.click(screen.getByRole("button", { name: "Arrêter le niveau du micro" }));
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
            button: "Couper le micro",
            value: 0,
            result: "Micro coupé (fait)",
            acted: true,
          },
          {
            at: "2026-01-01T10:00:05Z",
            device: "Jabra",
            button: "Décrocher / raccrocher",
            value: 1,
            result: "Aucun appel entrant à décrocher",
            acted: false,
          },
        ],
      }),
    });
    open();
    expect(screen.getByTestId("diag-headset-reading")).toHaveTextContent("Lecture des commandes du casque active");
    const [jabra, other] = screen.getAllByTestId("diag-headset-device");
    expect(jabra).toHaveTextContent("Décrocher / raccrocher, Couper le micro");
    expect(jabra).toHaveTextContent("Commandes activées");
    expect(jabra).toHaveTextContent("Casque utilisé");
    expect(other).toHaveTextContent("aucun bouton téléphonie standard");
    expect(other).toHaveTextContent("Pas celui de ZePhone");
    const log = screen.getByLabelText("Derniers événements du casque");
    expect(log).toHaveTextContent("Micro coupé (fait)");
    expect(log).toHaveTextContent("Aucun appel entrant à décrocher");
  });

  it("explains a refused HID permission and that the audio itself still works", () => {
    useAudioStore.setState({ headset: headsetState({ reading: { kind: "permissionNeeded" } }) });
    open();
    expect(screen.getByTestId("diag-headset-reading")).toHaveTextContent("macOS demande une autorisation");
    expect(screen.getByText(/l'audio du casque fonctionne, mais pas ses boutons/)).toBeInTheDocument();
  });

  it("does not claim a headset supports its buttons just because it is connected", () => {
    open();
    expect(screen.getByText(/Aucun casque n'expose de commandes téléphonie standard/)).toBeInTheDocument();
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
    expect(screen.getByTestId("diag-headset-device")).toHaveTextContent("Commandes désactivées");
  });
});
