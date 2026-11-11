import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, playMuteSound } = vi.hoisted(() => ({ invoke: vi.fn(), playMuteSound: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/ui-sounds", () => ({ playMuteSound: (...a: unknown[]) => playMuteSound(...a) }));

import { makeCall } from "@/test/fixtures";

import { useCallsStore } from "./calls-store";

beforeEach(() => {
  invoke.mockReset();
  playMuteSound.mockReset();
  useCallsStore.setState({ calls: { call1: makeCall({ state: "connected", muted: false }) }, dialing: false });
});

describe("mute cue", () => {
  it("plays the muting cue, then the unmuting cue, once the backend accepted the change", async () => {
    invoke.mockResolvedValue(undefined);
    await useCallsStore.getState().toggleMute("call1");
    expect(playMuteSound).toHaveBeenLastCalledWith(true);
    useCallsStore.getState().apply(makeCall({ state: "connected", muted: true }));
    await useCallsStore.getState().toggleMute("call1");
    expect(playMuteSound).toHaveBeenLastCalledWith(false);
    expect(playMuteSound).toHaveBeenCalledTimes(2);
  });

  it("stays silent when the backend refuses", async () => {
    invoke.mockRejectedValue({ kind: "engine", message: "non" });
    await useCallsStore.getState().toggleMute("call1");
    expect(playMuteSound).not.toHaveBeenCalled();
  });
});
