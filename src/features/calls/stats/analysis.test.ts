import { describe, expect, it } from "vitest";

import { makeRun, makeStats } from "@/test/fixtures";

import { diagnose, isBadSecond, summarize } from "./analysis";

const ids = (run: ReturnType<typeof makeRun>) => diagnose(run).map((h) => h.id);

describe("diagnose", () => {
  it("waits for a few seconds of call before judging", () => {
    expect(ids([])).toEqual(["wait"]);
    expect(ids(makeRun(2))).toEqual(["wait"]);
    // the set-up seconds do not count either
    expect(ids(makeRun(6, () => ({ jbufLost: 3 }), 0).slice(0, 4))).toEqual(["wait"]);
  });

  it("says plainly that nothing is wrong, and what the figures cannot see", () => {
    const hints = diagnose(makeRun(30));
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({ id: "clean", level: "ok" });
    expect(hints[0]?.detail).toContain("before ZePhone");
    expect(hints[0]?.detail).toContain("audio output");
  });

  it("puts the cut in the received stream when packets are lost or late", () => {
    const hints = diagnose(makeRun(20, (i) => (i === 7 ? { jbufLost: 2, jbufLate: 1 } : {})));
    const network = hints.find((h) => h.id === "network");
    expect(network?.level).toBe("warn");
    expect(network?.detail).toContain("2 lost packets");
    expect(network?.detail).toContain("1 packet arrived too late");
    expect(hints.some((h) => h.id === "clean")).toBe(false);
  });

  it("counts buffer flushes, but not the one of the call set-up", () => {
    expect(ids(makeRun(20, (i) => (i === 0 ? { jbufFlush: 1 } : {}), 0))).toEqual(["clean"]);
    expect(ids(makeRun(20, (i) => (i === 8 ? { jbufFlush: 1 } : {})))).toContain("buffer");
  });

  it("blames the computer, not the network, when blocks are late but nothing was lost", () => {
    const hints = diagnose(makeRun(20, (i) => (i === 5 ? { rxGapMaxMs: 64, rxLateBlocks: 1 } : {})));
    const h = hints.find((x) => x.id === "rx-blocks");
    expect(h?.detail).toContain("64 ms");
    expect(h?.detail).toContain("this Mac");
    // ...whereas with losses the network explanation stands alone
    const withLoss = ids(makeRun(20, (i) => (i === 5 ? { rxGapMaxMs: 64, jbufLost: 1 } : {})));
    expect(withLoss).toContain("network");
    expect(withLoss).not.toContain("rx-blocks");
  });

  it("notices a microphone that delivers late", () => {
    expect(ids(makeRun(20, (i) => (i === 3 ? { txGapMaxMs: 80 } : {})))).toContain("tx-blocks");
  });

  it("flags high jitter, a slow filter, a lossy recording and a long round trip", () => {
    expect(ids(makeRun(20, () => ({ rxJitterMs: 45 })))).toContain("jitter");
    expect(ids(makeRun(20, (i) => (i === 2 ? { rxBusyMaxUs: 9000 } : {})))).toContain("filter");
    expect(ids(makeRun(20, (i) => (i === 2 ? { recDropped: 480 } : {})))).toContain("recording");
    const rtt = diagnose(makeRun(20, () => ({ rttMs: 420 })));
    expect(rtt.find((h) => h.id === "rtt")?.level).toBe("info");
    // a long round trip alone is not a fault of the audio: the verdict stays clean
    expect(rtt.some((h) => h.id === "clean")).toBe(true);
  });

  it("recognises an incident every second as periodic, and says where it probably comes from", () => {
    const fromNetwork = diagnose(makeRun(30, () => ({ jbufLate: 1 })));
    expect(fromNetwork.find((h) => h.id === "periodic")?.detail).toContain("server or the link");
    const fromMachine = diagnose(makeRun(30, () => ({ rxGapMaxMs: 50 })));
    expect(fromMachine.find((h) => h.id === "periodic")?.detail).toContain("this computer");
    // a few isolated incidents are not periodic
    expect(ids(makeRun(30, (i) => (i % 10 === 0 ? { jbufLate: 1 } : {})))).not.toContain("periodic");
  });

  it("only looks at the last minute", () => {
    const old = makeRun(30, () => ({ jbufLost: 5 }), 5);
    const fresh = makeRun(60, () => ({}), 35);
    expect(ids([...old, ...fresh])).toEqual(["clean"]);
  });
});

describe("isBadSecond", () => {
  it("is false for a healthy second, true for each kind of incident", () => {
    expect(isBadSecond(makeStats())).toBe(false);
    expect(isBadSecond(makeStats({ jbufLate: 1 }))).toBe(true);
    expect(isBadSecond(makeStats({ jbufOverflow: 1 }))).toBe(true);
    expect(isBadSecond(makeStats({ rxGapMaxMs: 40 }))).toBe(true);
    expect(isBadSecond(makeStats({ txGapMaxMs: 40 }))).toBe(true);
  });
});

describe("summarize", () => {
  it("has nothing to say about an empty run", () => {
    expect(summarize([])).toBeNull();
  });

  it("gives the headline figures", () => {
    const run = makeRun(10, (i) => ({
      rxJitterMs: i === 3 ? 12 : 2,
      rttMs: i < 9 ? 25 : null,
      jbufLate: i === 6 ? 1 : 0,
    }));
    const s = summarize(run)!;
    expect(s.codec).toBe("PCMA");
    expect(s.clockRate).toBe(8000);
    expect(s.rxJitterMax).toBe(12);
    expect(s.rxJitterAvg).toBeCloseTo(3, 5);
    expect(s.rttMs).toBe(25); // the latest measured one
    expect(s.rxKbps).toBe(64);
    expect(s.incidents).toBe(1);
    expect(s.seconds).toBe(10);
  });
});
