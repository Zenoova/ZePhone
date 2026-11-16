import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { makeRun, makeStats } from "@/test/fixtures";

import { MAX_SAMPLES, useCallStatsStore } from "./call-stats-store";

beforeEach(() => {
  invoke.mockReset();
  useCallStatsStore.setState({ samples: {} });
});

describe("call statistics store", () => {
  it("keeps the samples of each call apart, oldest first", () => {
    const { push } = useCallStatsStore.getState();
    push(makeStats({ callId: "a", elapsedSecs: 1 }));
    push(makeStats({ callId: "b", elapsedSecs: 1 }));
    push(makeStats({ callId: "a", elapsedSecs: 2 }));
    const s = useCallStatsStore.getState().samples;
    expect(s.a?.map((x) => x.elapsedSecs)).toEqual([1, 2]);
    expect(s.b).toHaveLength(1);
  });

  it("keeps the most recent samples only", () => {
    const { push } = useCallStatsStore.getState();
    for (let i = 0; i < MAX_SAMPLES + 3; i++) push(makeStats({ elapsedSecs: i, atMs: i }));
    const list = useCallStatsStore.getState().samples.call1;
    expect(list).toHaveLength(MAX_SAMPLES);
    expect(list?.[0]?.atMs).toBe(3);
  });

  it("loads what happened before the window opened, without doubling the live samples", async () => {
    const history = makeRun(5, () => ({}), 1);
    invoke.mockResolvedValue(history);
    // a live sample arrived while the history was on its way: it is the last of the history
    useCallStatsStore.getState().push(history[4]!);
    await useCallStatsStore.getState().load("call1");
    expect(invoke).toHaveBeenCalledWith("get_call_stats", { callId: "call1" });
    expect(useCallStatsStore.getState().samples.call1).toHaveLength(5);
  });

  it("falls back on the live samples when the history cannot be read", async () => {
    invoke.mockRejectedValue(new Error("nope"));
    useCallStatsStore.getState().push(makeStats());
    await useCallStatsStore.getState().load("call1");
    expect(useCallStatsStore.getState().samples.call1).toHaveLength(1);
  });

  it("forgets a call that is over", () => {
    useCallStatsStore.getState().push(makeStats());
    useCallStatsStore.getState().drop("call1");
    expect(useCallStatsStore.getState().samples).toEqual({});
    useCallStatsStore.getState().drop("unknown"); // no effect, no error
  });
});
