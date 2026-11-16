import type { CallStatsSample } from "@/types/telephony";

/** Audio blocks reach the filter every 20 ms: a wait longer than this is heard as a cut. */
export const BLOCK_MS = 20;
export const GAP_WARN_MS = 35;
export const JITTER_WARN_MS = 30;
export const RTT_WARN_MS = 300;
export const BUSY_WARN_US = 5000;
/** The first seconds of a call (stream set-up, buffer settling) are not judged. */
export const SETUP_SECS = 4;
/** How far back the findings look. */
export const WINDOW = 60;

export type HintLevel = "ok" | "info" | "warn";

export interface Hint {
  id: string;
  level: HintLevel;
  title: string;
  detail: string;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const max = (xs: number[]) => xs.reduce((a, b) => Math.max(a, b), 0);
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Did something go wrong in this second, in the stream we receive or at the audio blocks? */
export function isBadSecond(s: CallStatsSample): boolean {
  return (
    s.jbufLost + s.jbufLate + s.jbufOverflow + s.jbufFlush > 0 ||
    s.rxGapMaxMs > GAP_WARN_MS ||
    s.txGapMaxMs > GAP_WARN_MS
  );
}

/**
 * Reads the last minute of a call and says in plain words what the numbers mean. It never claims more than the
 * measurements show: it tells where the cut is (in what arrives, or in how this computer handles it), and when the
 * measurements are clean it says so and names what they cannot see.
 */
export function diagnose(samples: CallStatsSample[]): Hint[] {
  const recent = samples.slice(-WINDOW).filter((s) => s.elapsedSecs >= SETUP_SECS);
  if (recent.length < 3) {
    return [
      {
        id: "wait",
        level: "info",
        title: "Measuring",
        detail: "It takes a few seconds of call to judge the sound quality.",
      },
    ];
  }
  const hints: Hint[] = [];
  const n = recent.length;
  const lost = sum(recent.map((s) => s.jbufLost));
  const late = sum(recent.map((s) => s.jbufLate));
  const flush = sum(recent.map((s) => s.jbufFlush));
  const overflow = sum(recent.map((s) => s.jbufOverflow));
  const network = lost + late + flush + overflow;

  if (lost + late > 0) {
    const parts = [
      lost > 0 ? `${plural(lost, "lost packet", "lost packets")}` : "",
      late > 0 ? `${plural(late, "packet arrived too late", "packets arrived too late")}` : "",
    ].filter(Boolean);
    hints.push({
      id: "network",
      level: "warn",
      title: "Voice packets are lost or arrive too late",
      detail: `${parts.join(" and ")} over the last ${n} seconds. The gap is in the received stream: network (Wi-Fi, VPN, router), or the service's server sending the sound at irregular intervals.`,
    });
  }
  if (flush + overflow > 0) {
    hints.push({
      id: "buffer",
      level: "warn",
      title: "The buffer had to be flushed",
      detail: `${plural(flush, "flush", "flushes")} and ${plural(overflow, "overflow", "overflows")}: each time, a few tens of milliseconds of voice are skipped.`,
    });
  }
  const jitter = max(recent.map((s) => s.rxJitterMs));
  if (jitter > JITTER_WARN_MS) {
    hints.push({
      id: "jitter",
      level: "warn",
      title: "High jitter",
      detail: `Packets arrive with up to ${jitter.toFixed(0)} ms of irregularity (healthy: under ${JITTER_WARN_MS} ms). Wi-Fi or a busy link is the usual cause.`,
    });
  }
  const rxGap = max(recent.map((s) => s.rxGapMaxMs));
  if (rxGap > GAP_WARN_MS && network === 0) {
    hints.push({
      id: "rx-blocks",
      level: "warn",
      title: "The received sound is delivered in jerks while the network is clean",
      detail: `Up to ${rxGap.toFixed(0)} ms between two 20 ms blocks. Nothing was lost on the way: this Mac is busy (processor, graphics card) or the audio output is hiccuping (Bluetooth, USB interface).`,
    });
  }
  const txGap = max(recent.map((s) => s.txGapMaxMs));
  if (txGap > GAP_WARN_MS) {
    hints.push({
      id: "tx-blocks",
      level: "warn",
      title: "The microphone delivers its voice late",
      detail: `Up to ${txGap.toFixed(0)} ms between two 20 ms blocks. The other side then hears dropouts: Bluetooth microphone, USB interface or overloaded machine.`,
    });
  }
  const busy = Math.max(...recent.map((s) => Math.max(s.rxBusyMaxUs, s.txBusyMaxUs)));
  if (busy > BUSY_WARN_US) {
    hints.push({
      id: "filter",
      level: "warn",
      title: "ZePhone's audio processing is slow",
      detail: `A block took ${(busy / 1000).toFixed(1)} ms to process (it should take less than a tenth of that).`,
    });
  }
  if (sum(recent.map((s) => s.recDropped)) > 0) {
    hints.push({
      id: "recording",
      level: "warn",
      title: "The recording lost some sound",
      detail: "The disk did not keep up: the call is not affected, but the recording has gaps.",
    });
  }
  const bad = recent.slice(-30).filter(isBadSecond).length;
  const span = Math.min(30, n);
  if (bad >= 5 && bad / span >= 0.6) {
    hints.push({
      id: "periodic",
      level: "warn",
      title: "An incident almost every second",
      detail: `${bad} seconds out of the last ${span}. Such regularity points to a periodic cause: ${network > 0 ? "the server or the link sending the sound in bursts" : "a task on this computer that comes back every second"}.`,
    });
  }
  const rtt = max(recent.map((s) => s.rttMs ?? 0));
  if (rtt > RTT_WARN_MS) {
    hints.push({
      id: "rtt",
      level: "info",
      title: "Long round-trip delay",
      detail: `${rtt.toFixed(0)} ms to the other party: the conversation lags, but the sound is not cut.`,
    });
  }
  if (!hints.some((h) => h.level === "warn")) {
    hints.unshift({
      id: "clean",
      level: "ok",
      title: `No irregularity over the last ${n} seconds`,
      detail:
        "No packet lost or late, the buffer was not flushed and the audio blocks pass every 20 ms. If you still hear dropouts, they come from before ZePhone (the service or its server: try another echo number) or from the computer's audio output (speaker, headset).",
    });
  }
  return hints;
}

export interface Summary {
  codec: string;
  clockRate: number;
  rxJitterAvg: number;
  rxJitterMax: number;
  rttMs: number | null;
  jbufDelayAvg: number;
  rxKbps: number;
  txKbps: number;
  lossPct: number;
  incidents: number;
  seconds: number;
}

/** The headline figures of a run of samples. */
export function summarize(samples: CallStatsSample[]): Summary | null {
  const last = samples.at(-1);
  if (!last) return null;
  const jitters = samples.map((s) => s.rxJitterMs);
  const delays = samples.map((s) => s.jbufDelayMs);
  const rtt = [...samples].reverse().find((s) => s.rttMs !== null)?.rttMs ?? null;
  return {
    codec: last.totals.codec,
    clockRate: last.totals.clockRate,
    rxJitterAvg: sum(jitters) / jitters.length,
    rxJitterMax: max(jitters),
    rttMs: rtt,
    jbufDelayAvg: sum(delays) / delays.length,
    rxKbps: last.rxBitrate / 1000,
    txKbps: last.txBitrate / 1000,
    lossPct: last.totals.lossPct,
    incidents: samples.filter((s) => s.elapsedSecs >= SETUP_SECS && isBadSecond(s)).length,
    seconds: samples.length,
  };
}
