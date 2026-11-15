import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, toast } = vi.hoisted(() => ({
  invoke: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@yusufceng1z/ding-react", () => ({ toast }));

import { makeCall } from "@/test/fixtures";

import { ENDED_LINGER_MS, selectIncoming, selectLiveCalls, sortedCalls, useCallsStore } from "./calls-store";

beforeEach(() => {
  vi.useFakeTimers();
  invoke.mockReset();
  toast.error.mockReset();
  useCallsStore.setState({ calls: {}, dialing: false });
});

describe("call lifecycle in the store", () => {
  it("stores updates and removes finished calls after the linger delay", () => {
    const { apply } = useCallsStore.getState();
    apply(makeCall({ state: "connected" }));
    expect(useCallsStore.getState().calls.call1?.state).toBe("connected");

    apply(makeCall({ state: "ended", durationSecs: 12 }));
    expect(useCallsStore.getState().calls.call1?.state).toBe("ended");
    vi.advanceTimersByTime(ENDED_LINGER_MS - 1);
    expect(useCallsStore.getState().calls.call1).toBeDefined();
    vi.advanceTimersByTime(2);
    expect(useCallsStore.getState().calls.call1).toBeUndefined();
  });

  it("shows the failure reason and does not drop a call that resumed before the timer fired", () => {
    const { apply } = useCallsStore.getState();
    apply(makeCall({ state: "failed", reason: "Occupé (486)" }));
    expect(toast.error).toHaveBeenCalledWith("Occupé (486)");
    apply(makeCall({ state: "connected" })); // same id reused: timer must be cancelled
    vi.advanceTimersByTime(ENDED_LINGER_MS * 2);
    expect(useCallsStore.getState().calls.call1?.state).toBe("connected");
  });

  it("hydrates from a snapshot", () => {
    useCallsStore.getState().hydrate([makeCall({ id: "a" }), makeCall({ id: "b", state: "incoming" })]);
    expect(Object.keys(useCallsStore.getState().calls).sort()).toEqual(["a", "b"]);
  });
});

describe("intents sent to the backend", () => {
  it("dial invokes the backend and stores the returned call", async () => {
    invoke.mockResolvedValueOnce(makeCall({ state: "initializing" }));
    const call = await useCallsStore.getState().dial("1002", null);
    expect(invoke).toHaveBeenCalledWith("dial", { target: "1002", accountId: null });
    expect(call?.id).toBe("call1");
    expect(useCallsStore.getState().calls.call1?.state).toBe("initializing");
    expect(useCallsStore.getState().dialing).toBe(false);
  });

  it("dial failure becomes a toast, not an exception", async () => {
    invoke.mockRejectedValueOnce({ kind: "validation", message: "Aucun compte SIP n'est connecté" });
    const call = await useCallsStore.getState().dial("1002");
    expect(call).toBeNull();
    expect(toast.error).toHaveBeenCalledWith("Aucun compte SIP n'est connecté");
    expect(useCallsStore.getState().dialing).toBe(false);
  });

  it("hold toggles between hold and resume depending on the state", async () => {
    invoke.mockResolvedValue(undefined);
    const { apply, toggleHold } = useCallsStore.getState();
    apply(makeCall({ state: "connected" }));
    await toggleHold("call1");
    expect(invoke).toHaveBeenLastCalledWith("hold_call", { id: "call1" });
    apply(makeCall({ state: "onHold", heldLocally: true }));
    await toggleHold("call1");
    expect(invoke).toHaveBeenLastCalledWith("resume_call", { id: "call1" });
  });

  it("mute sends the opposite of the current state", async () => {
    invoke.mockResolvedValue(undefined);
    const { apply, toggleMute } = useCallsStore.getState();
    apply(makeCall({ state: "connected", muted: false }));
    await toggleMute("call1");
    expect(invoke).toHaveBeenLastCalledWith("set_call_mute", { id: "call1", muted: true });
    apply(makeCall({ state: "connected", muted: true }));
    await toggleMute("call1");
    expect(invoke).toHaveBeenLastCalledWith("set_call_mute", { id: "call1", muted: false });
  });

  it("answer, reject, hangup, dtmf and transfer map to their commands", async () => {
    invoke.mockResolvedValue(undefined);
    const s = useCallsStore.getState();
    await s.answer("x");
    await s.reject("x");
    await s.hangup("x");
    await s.sendDtmf("x", "5");
    expect(await s.transfer("x", "1005")).toBe(true);
    expect(invoke.mock.calls.map((c) => c[0])).toEqual([
      "answer_call",
      "reject_call",
      "hangup_call",
      "send_dtmf",
      "transfer_call",
    ]);
    expect(invoke).toHaveBeenCalledWith("transfer_call", { id: "x", target: "1005" });
  });

  it("transfer reports failure", async () => {
    invoke.mockRejectedValueOnce({ kind: "engine", message: "refusé" });
    expect(await useCallsStore.getState().transfer("x", "1")).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("refusé");
  });
});

describe("selectors", () => {
  const calls = Object.fromEntries(
    [
      makeCall({ id: "a", state: "connected", createdAt: "2026-01-01T10:00:00Z" }),
      makeCall({ id: "b", state: "incoming", createdAt: "2026-01-01T10:05:00Z" }),
      makeCall({ id: "c", state: "ended", createdAt: "2026-01-01T09:00:00Z" }),
    ].map((c) => [c.id, c]),
  );
  it("orders incoming first, ended last", () => {
    expect(sortedCalls(calls).map((c) => c.id)).toEqual(["b", "a", "c"]);
  });
  it("splits incoming and live calls", () => {
    expect(selectIncoming(calls).map((c) => c.id)).toEqual(["b"]);
    expect(selectLiveCalls(calls).map((c) => c.id)).toEqual(["a"]);
  });
});
