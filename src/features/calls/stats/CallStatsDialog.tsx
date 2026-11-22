import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/arc/button/button";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { CircleAlert, CircleCheck, Info } from "@/components/icons";
import { cn } from "@/lib/utils";
import { useCallStatsStore } from "@/stores/call-stats-store";
import type { Call, CallStatsSample } from "@/types/telephony";

import { BLOCK_MS, GAP_WARN_MS, JITTER_WARN_MS, diagnose, summarize, type Hint, type HintLevel } from "./analysis";
import { TimeChart } from "./TimeChart";

const NO_SAMPLES: CallStatsSample[] = [];

/** How much of the call the charts show, in seconds (0 = everything kept). */
const RANGES: Array<{ secs: number; label: string }> = [
  { secs: 60, label: "1 min" },
  { secs: 300, label: "5 min" },
  { secs: 0, label: "All" },
];

const HINT_ICON: Record<HintLevel, typeof Info> = { ok: CircleCheck, info: Info, warn: CircleAlert };
const HINT_TONE: Record<HintLevel, string> = {
  ok: "text-success",
  info: "text-muted-foreground",
  warn: "text-warning",
};

function HintRow({ hint }: { hint: Hint }) {
  const Icon = HINT_ICON[hint.level];
  return (
    <li className="flex gap-2.5" data-testid="stats-hint" data-level={hint.level}>
      <Icon className={cn("mt-0.5 size-4", HINT_TONE[hint.level])} />
      <div className="min-w-0">
        <p className="font-medium">{hint.title}</p>
        <p className="text-muted-foreground text-xs leading-relaxed">{hint.detail}</p>
      </div>
    </li>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-muted/60 rounded-xl px-3 py-2">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-base leading-tight font-semibold">{value}</dd>
      {sub && <dd className="text-muted-foreground text-xs">{sub}</dd>}
    </div>
  );
}

const ms = (v: number) => `${v.toFixed(v < 10 ? 1 : 0)} ms`;

/**
 * Live graphs about the audio of a call: what arrives from the network, what the jitter buffer does with it, how
 * regularly the audio blocks reach the speaker and leave the microphone — and a reading of those numbers in plain
 * words. Measured by the engine, once a second; nothing leaves the computer.
 */
export function CallStatsDialog({
  call,
  open,
  onOpenChange,
}: {
  call: Call;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const all = useCallStatsStore((s) => s.samples[call.id]) ?? NO_SAMPLES;
  const load = useCallStatsStore((s) => s.load);
  const [range, setRange] = useState(60);

  useEffect(() => {
    if (open) void load(call.id);
  }, [open, call.id, load]);

  const shown = useMemo(() => (range ? all.slice(-range) : all), [all, range]);
  const xs = useMemo(() => shown.map((s) => s.elapsedSecs), [shown]);
  const col = (pick: (s: CallStatsSample) => number | null) => shown.map(pick);
  const summary = useMemo(() => summarize(all), [all]);
  const hints = useMemo(() => diagnose(all), [all]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Advanced statistics"
        description="What the engine measures on the call's sound, once per second."
        style={{ width: "min(calc(100vw - 2rem), 980px)" }}
      >
        <div className="space-y-4" data-testid="call-stats">
          <div className="flex items-center justify-between gap-3">
            <p className="text-muted-foreground text-xs" data-testid="stats-count">
              {all.length === 0
                ? "The first measurements arrive in a second."
                : `${all.length} ${all.length > 1 ? "seconds measured" : "second measured"}`}
            </p>
            <div className="flex gap-1" role="group" aria-label="Period shown">
              {RANGES.map((r) => (
                <Button
                  key={r.secs}
                  size="sm"
                  variant={range === r.secs ? "secondary" : "ghost"}
                  aria-pressed={range === r.secs}
                  onClick={() => setRange(r.secs)}
                >
                  {r.label}
                </Button>
              ))}
            </div>
          </div>

          {summary && (
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="stats-summary">
              <Tile label="Codec" value={summary.codec || "—"} sub={`${summary.clockRate / 1000} kHz`} />
              <Tile label="Received jitter" value={ms(summary.rxJitterAvg)} sub={`up to ${ms(summary.rxJitterMax)}`} />
              <Tile label="Round trip" value={summary.rttMs === null ? "—" : ms(summary.rttMs)} />
              <Tile label="Buffer" value={ms(summary.jbufDelayAvg)} sub="added delay" />
              <Tile label="Lost packets" value={`${summary.lossPct.toFixed(1)} %`} />
              <Tile label="Seconds with problems" value={`${summary.incidents} / ${summary.seconds}`} />
            </dl>
          )}

          <section
            aria-label="Reading the measurements"
            className="border-border space-y-3 rounded-xl border p-3 text-sm"
          >
            <ul className="space-y-3" data-testid="stats-hints">
              {hints.map((h) => (
                <HintRow key={h.id} hint={h} />
              ))}
            </ul>
          </section>

          <div className="grid grid-cols-1 gap-x-6 gap-y-5 min-[820px]:grid-cols-2">
            <TimeChart
              testId="chart-jitter"
              title="Jitter and round trip"
              hint={`Packet arrival irregularity: above ${JITTER_WARN_MS} ms, the sound degrades.`}
              xs={xs}
              unit="ms"
              minTop={20}
              thresholds={[{ value: JITTER_WARN_MS, label: `${JITTER_WARN_MS} ms` }]}
              series={[
                { key: "rx", label: "Received jitter", slot: 1, values: col((s) => s.rxJitterMs) },
                { key: "tx", label: "Jitter of our voice", slot: 2, values: col((s) => s.txJitterMs) },
                { key: "rtt", label: "Round trip", slot: 3, values: col((s) => s.rttMs) },
              ]}
            />
            <TimeChart
              testId="chart-incidents"
              title="Problems with the received sound"
              hint="Per second. Each bar is a possible gap in the voice."
              kind="bars"
              xs={xs}
              unit="packets"
              minTop={4}
              digits={0}
              series={[
                { key: "late", label: "Arrived too late", slot: 1, values: col((s) => s.jbufLate) },
                { key: "lost", label: "Lost", slot: 2, values: col((s) => s.jbufLost) },
                { key: "overflow", label: "Overflows", slot: 3, values: col((s) => s.jbufOverflow) },
                { key: "flush", label: "Flushes", slot: 4, values: col((s) => s.jbufFlush) },
              ]}
            />
            <TimeChart
              testId="chart-blocks"
              title="Regularity of the audio blocks"
              hint={`Longest wait between two blocks, per second: ${BLOCK_MS} ms when all is well.`}
              xs={xs}
              unit="ms"
              minTop={50}
              thresholds={[
                { value: BLOCK_MS, label: `${BLOCK_MS} ms` },
                { value: GAP_WARN_MS, label: "audible dropout" },
              ]}
              series={[
                { key: "rx", label: "To the speaker", slot: 1, values: col((s) => s.rxGapMaxMs) },
                { key: "tx", label: "From the microphone", slot: 2, values: col((s) => s.txGapMaxMs) },
              ]}
            />
            <TimeChart
              testId="chart-buffer"
              title="Buffer"
              hint="Delay that the buffer adds to absorb jitter: too low, and the slightest irregularity cuts out."
              xs={xs}
              unit="ms"
              minTop={100}
              digits={0}
              series={[{ key: "delay", label: "Added delay", slot: 1, values: col((s) => s.jbufDelayMs) }]}
            />
            <TimeChart
              testId="chart-bitrate"
              title="Bitrate"
              hint="A steady codec sends a constant bitrate; dips are missing packets."
              xs={xs}
              unit="kbit/s"
              minTop={16}
              digits={0}
              series={[
                { key: "rx", label: "Received", slot: 1, values: col((s) => s.rxBitrate / 1000) },
                { key: "tx", label: "Sent", slot: 2, values: col((s) => s.txBitrate / 1000) },
              ]}
            />
            <TimeChart
              testId="chart-filter"
              title="Audio filter processing time"
              hint="The longest time ZePhone spent on a block: a few tens of µs."
              xs={xs}
              unit="µs"
              minTop={100}
              digits={0}
              series={[
                { key: "rx", label: "Received audio", slot: 1, values: col((s) => s.rxBusyMaxUs) },
                { key: "tx", label: "Microphone", slot: 2, values: col((s) => s.txBusyMaxUs) },
              ]}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
