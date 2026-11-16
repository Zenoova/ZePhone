import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, toast } = vi.hoisted(() => ({
  invoke: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@yusufceng1z/ding-react", () => ({ toast }));

import { useAudioStore } from "@/stores/audio-store";
import { DEFAULT_SETTINGS } from "@/stores/settings-store";
import { makeBackend } from "@/test/backend";
import { makeCall } from "@/test/fixtures";
import type { AudioState, DeviceInfo, Notice, RoleState } from "@/types/audio";

import { AudioDevicePicker } from "./AudioDevicePicker";
import { AudioNoticeBanner } from "./AudioNoticeBanner";

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

const role = (r: "microphone" | "speaker" | "ringer", over: Partial<RoleState> = {}): RoleState => ({
  role: r,
  label: r,
  choice: { selection: { kind: "follow", source: "systemDefault" }, fallback: null },
  resolution: { role: r, used: USB, source: "following", problems: [], learnedUid: null },
  inUse: USB,
  notice: null,
  refused: null,
  choices: r === "microphone" ? [MIC, USB] : [SPK, USB],
  ...over,
});
const state = (roles: RoleState[]): AudioState => ({
  snapshot: { devices: [MIC, SPK, USB], defaultInput: "mic", defaultOutput: "spk", alertOutput: "spk" },
  roles,
  routing: DEFAULT_SETTINGS.audio.routing,
  inCall: true,
  supportsCommunicationDefault: false,
});

let backend: ReturnType<typeof makeBackend>;
beforeEach(() => {
  invoke.mockReset();
  Object.values(toast).forEach((f) => f.mockReset());
  backend = makeBackend(invoke, { audio_choose: () => undefined });
  useAudioStore.setState({ state: state([role("microphone"), role("speaker"), role("ringer")]) });
});

describe("AudioDevicePicker", () => {
  it("shows the readable names, the one in use, and a live microphone indicator", () => {
    render(<AudioDevicePicker call={makeCall({ state: "connected", muted: false })} />);
    fireEvent.click(screen.getByRole("button", { name: "Audio devices" }));
    expect(screen.getByTestId("mic-indicator")).toHaveTextContent("Microphone on");
    const mics = screen.getByRole("list", { name: "Microphone" });
    expect(mics).toHaveTextContent("MacBook Pro Microphone");
    expect(mics.querySelector("[aria-current='true']")).toHaveTextContent("Jabra Evolve2 65");
  });

  it("shows when the microphone is muted", () => {
    render(<AudioDevicePicker call={makeCall({ state: "connected", muted: true })} />);
    fireEvent.click(screen.getByRole("button", { name: "Audio devices" }));
    expect(screen.getByTestId("mic-indicator")).toHaveTextContent("Muted");
  });

  it("moves the call to the picked device for this call only, unless asked to keep it", async () => {
    render(<AudioDevicePicker call={makeCall({ state: "connected" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Audio devices" }));
    fireEvent.click(screen.getByRole("button", { name: /MacBook Pro Speakers/ }));
    await waitFor(() => expect(backend.calls("audio_choose")).toHaveLength(1));
    expect(backend.calls("audio_choose")[0]).toEqual({ role: "speaker", uid: "spk", remember: false });
    fireEvent.click(screen.getByRole("switch", { name: "Keep this choice" }));
    fireEvent.click(screen.getByRole("button", { name: /MacBook Pro Microphone/ }));
    await waitFor(() => expect(backend.calls("audio_choose")).toHaveLength(2));
    expect(backend.calls("audio_choose")[1]).toEqual({ role: "microphone", uid: "mic", remember: true });
  });

  it("flags a loudspeaker so nobody picks the room by mistake", () => {
    render(<AudioDevicePicker call={makeCall({ state: "connected" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Audio devices" }));
    expect(screen.getByText("speaker")).toBeInTheDocument();
  });
});

describe("AudioNoticeBanner", () => {
  const lost: Notice = { role: "speaker", kind: "lost", name: "Jabra Evolve2 65", why: "deviceLost", blocked: null };

  it("says at once what happened and that the call goes on, and offers a simple way to choose", async () => {
    useAudioStore.setState({ state: state([role("microphone"), role("speaker", { notice: lost }), role("ringer")]) });
    render(<AudioNoticeBanner />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("“Jabra Evolve2 65” is no longer available");
    expect(alert).toHaveTextContent("The call continues");
    fireEvent.click(screen.getByRole("button", { name: "Choose another device" }));
    fireEvent.click(screen.getByRole("button", { name: /MacBook Pro Speakers/ }));
    await waitFor(() => expect(backend.calls("audio_choose")).toHaveLength(1));
    expect(backend.calls("audio_choose")[0]).toMatchObject({ role: "speaker", uid: "spk" });
  });

  it("explains that the call was not moved to loudspeakers without permission", () => {
    const blocked: Notice = { ...lost, kind: "lost", why: "publicSpeaker", blocked: "MacBook Pro Speakers" };
    useAudioStore.setState({
      state: state([role("microphone"), role("speaker", { notice: blocked }), role("ringer")]),
    });
    render(<AudioNoticeBanner />);
    expect(screen.getByRole("alert")).toHaveTextContent("speakers that everyone can hear");
  });

  it("tells an automatic switch as information, not as an alarm", () => {
    const switched: Notice = {
      role: "speaker",
      kind: "switched",
      from: "Jabra Evolve2 65",
      to: "Desk Speaker",
      why: "fallback",
    };
    useAudioStore.setState({
      state: state([role("microphone"), role("speaker", { notice: switched }), role("ringer")]),
    });
    render(<AudioNoticeBanner />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("The sound moved from “Jabra Evolve2 65” to “Desk Speaker”");
    expect(screen.queryByRole("button", { name: "Choose another device" })).toBeNull();
  });

  it("is silent when nothing happened, and ignores the ringer", () => {
    useAudioStore.setState({
      state: state([role("microphone"), role("speaker"), role("ringer", { notice: { ...lost, role: "ringer" } })]),
    });
    const { container } = render(<AudioNoticeBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});
