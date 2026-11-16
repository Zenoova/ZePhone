/**
 * DEV-ONLY stand-in for the audio and headset commands of the Rust backend, used by the browser preview
 * (`/?mock`). Nothing here touches a device: the devices below are FICTIONAL, and one saved choice is
 * deliberately "unplugged" to see that state. A real headset is only ever shown by the real application.
 */
import type {
  AudioState,
  DeviceInfo,
  HeadsetState,
  Resolution,
  Role,
  RoleChoice,
  RoleState,
  Routing,
} from "@/types/audio";
import { DEFAULT_SETTINGS } from "@/stores/settings-store";

type Args = Record<string, unknown> | undefined;

const dev = (
  uid: string,
  name: string,
  transport: DeviceInfo["transport"],
  inputChannels: number,
  outputChannels: number,
  extra: Partial<DeviceInfo> = {},
): DeviceInfo => ({
  uid,
  name,
  transport,
  inputChannels,
  outputChannels,
  alive: true,
  publicSpeaker: transport === "builtIn" && outputChannels > 0,
  inUseElsewhere: false,
  selectable: true,
  duplicateName: false,
  ...extra,
});

export function createMockAudio(emit: (event: string, payload: unknown) => void): Record<string, (a: Args) => unknown> {
  const devices: DeviceInfo[] = [
    dev("mic", "MacBook Pro Microphone", "builtIn", 1, 0),
    dev("spk", "MacBook Pro Speakers", "builtIn", 0, 2),
    dev("usb", "Jabra Evolve2 65 (aperçu)", "usb", 1, 2, { inUseElsewhere: true }),
    dev("bt", "AirPods (aperçu)", "bluetooth", 1, 2),
  ];
  // The headset the user chose for the conversation is absent: the speaker role shows what happens meanwhile.
  const routing: Routing = {
    ...DEFAULT_SETTINGS.audio.routing,
    speaker: {
      selection: { kind: "explicit", device: { uid: "gone", name: "Casque de bureau (aperçu)" } },
      fallback: null,
    },
    microphone: {
      selection: { kind: "explicit", device: { uid: "usb", name: "Jabra Evolve2 65 (aperçu)" } },
      fallback: { uid: "mic", name: "MacBook Pro Microphone" },
    },
  };
  const inCall = false;
  const inUse: Record<Role, string | null> = { microphone: "usb", speaker: "spk", ringer: "spk" };

  const fits = (role: Role, d: DeviceInfo) =>
    d.alive && (role === "microphone" ? d.inputChannels > 0 : d.outputChannels > 0);
  const resolve = (role: Role, choice: RoleChoice): Resolution => {
    const pool = devices.filter((d) => fits(role, d));
    const def = pool.find((d) => d.uid === (role === "microphone" ? "mic" : "spk")) ?? null;
    if (choice.selection.kind === "follow")
      return { role, used: def, source: "following", problems: [], learnedUid: null };
    const wanted = choice.selection.device;
    const found = pool.find((d) => d.uid === wanted.uid);
    if (found) return { role, used: found, source: "chosen", problems: [], learnedUid: null };
    const fb = choice.fallback ? pool.find((d) => d.uid === choice.fallback?.uid) : undefined;
    return {
      role,
      used: fb ?? def,
      source: fb ? "fallback" : "systemInstead",
      problems: [{ kind: "chosenUnavailable", name: wanted.name }],
      learnedUid: null,
    };
  };
  const state = (): AudioState => ({
    snapshot: { devices, defaultInput: "mic", defaultOutput: "spk", alertOutput: "spk" },
    routing,
    inCall,
    supportsCommunicationDefault: false,
    roles: (["microphone", "speaker", "ringer"] as Role[]).map((role): RoleState => {
      const choice = routing[role];
      const resolution = resolve(role, choice);
      const used = inUse[role] ? devices.find((d) => d.uid === inUse[role]) : undefined;
      return {
        role,
        label: { microphone: "Microphone", speaker: "Sortie des conversations", ringer: "Sonnerie" }[role],
        choice,
        resolution,
        inUse: used ?? resolution.used,
        notice: null,
        refused: null,
        choices: devices.filter((d) => fits(role, d)),
      };
    }),
  });
  const headset = (): HeadsetState => ({
    settings: DEFAULT_SETTINGS.audio.headset,
    reading: { kind: "listening" },
    devices: [
      {
        id: "0b0e:0412:1",
        product: "Jabra Evolve2 65 (aperçu)",
        manufacturer: "GN Audio (aperçu)",
        transport: "USB",
        buttons: ["hookSwitch", "phoneMute"],
        inUse: true,
      },
    ],
    log: [
      {
        at: new Date(Date.now() - 60_000).toISOString(),
        device: "Jabra Evolve2 65 (aperçu)",
        button: "Décrocher / raccrocher",
        value: 1,
        result: "Aucun appel entrant à décrocher",
        acted: false,
      },
    ],
    vendorAvailable: false,
  });
  return {
    audio_state: () => state(),
    audio_choose: (a) => {
      inUse[a?.role as Role] = String(a?.uid);
      emit("audio:state", state());
    },
    audio_test: () => undefined,
    audio_meter: (a) => {
      if (a?.on) {
        let t = 0;
        const id = setInterval(() => {
          emit("audio:test-level", -40 + 25 * Math.abs(Math.sin(t++ / 4)));
          if (t > 60) clearInterval(id);
        }, 80);
      }
    },
    headset_state: () => headset(),
  };
}
