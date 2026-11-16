import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { clock, linePath, niceAxis } from "./chart-math";

/** One line (or one stack of bars) of a chart. The colour follows the series, in a fixed order of slots. */
export interface ChartSeries {
  key: string;
  label: string;
  /** Categorical colour slot, 1 to 5 (`--viz-N`). */
  slot: 1 | 2 | 3 | 4 | 5;
  /** One value per sample; `null` leaves a gap. */
  values: Array<number | null>;
}

export interface Threshold {
  value: number;
  label: string;
}

interface TimeChartProps {
  title: string;
  /** One line under the title: what the chart shows and what is good. */
  hint?: string;
  /** Seconds since the start of the call, one per sample. */
  xs: number[];
  series: ChartSeries[];
  /** `line`: one line per series. `bars`: counts per second, stacked. */
  kind?: "line" | "bars";
  unit: string;
  /** The axis never ends below this, so that a calm line does not look dramatic. */
  minTop: number;
  thresholds?: Threshold[];
  /** Decimals shown for values. */
  digits?: number;
  height?: number;
  testId?: string;
}

const MARGIN = { l: 40, r: 10, t: 18, b: 22 };
const GAP = 2; // between stacked segments, in the colour of the surface

function fmt(v: number | null, digits: number): string {
  if (v === null) return "—";
  return v.toLocaleString("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** Width of the element, kept up to date (480 where nothing can be measured). */
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(480);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 120) setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/**
 * A chart over time in plain SVG: a crosshair that snaps to the nearest second, one tooltip with every series,
 * arrow keys for the keyboard. The grid is a hairline, lines are 2 px, stacked bars are separated by a surface-coloured gap.
 */
export function TimeChart({
  title,
  hint,
  xs,
  series,
  kind = "line",
  unit,
  minTop,
  thresholds = [],
  digits = 1,
  height = 168,
  testId,
}: TimeChartProps) {
  const [box, width] = useWidth();
  const [cursor, setCursor] = useState<number | null>(null);
  const n = xs.length;
  const xAt = (i: number) => xs[i] ?? 0;

  const W = width;
  const pw = W - MARGIN.l - MARGIN.r;
  const ph = height - MARGIN.t - MARGIN.b;
  const x0 = xs[0] ?? 0;
  const x1 = Math.max(xs[n - 1] ?? 0, x0 + 10);

  const { top, ticks: yTicks } = useMemo(() => {
    let max = 0;
    for (let i = 0; i < n; i++) {
      if (kind === "bars")
        max = Math.max(
          max,
          series.reduce((t, s) => t + (s.values[i] ?? 0), 0),
        );
      else for (const s of series) max = Math.max(max, s.values[i] ?? 0);
    }
    for (const t of thresholds) max = Math.max(max, t.value * 1.15);
    return niceAxis(max, minTop);
  }, [n, kind, series, thresholds, minTop]);

  const px = (x: number) => MARGIN.l + ((x - x0) / (x1 - x0)) * pw;
  const py = (v: number) => MARGIN.t + ph - (Math.min(v, top) / top) * ph;

  const stepX = [5, 10, 15, 30, 60, 120, 300, 600].find((s) => (x1 - x0) / s <= 6) ?? 600;
  const xTicks: number[] = [];
  for (let t = Math.ceil(x0 / stepX) * stepX; t <= x1; t += stepX) xTicks.push(t);

  const nearest = (clientX: number, rect: DOMRect): number => {
    const x = x0 + ((clientX - rect.left - MARGIN.l) / pw) * (x1 - x0);
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(xAt(i) - x) < Math.abs(xAt(best) - x)) best = i;
    return best;
  };

  const slot = bandWidth(n, pw);
  const description = series
    .map((s) => {
      const vals = s.values.filter((v): v is number => v !== null);
      const last = vals.at(-1) ?? null;
      return `${s.label} : ${fmt(last, digits)} ${unit} (maximum ${fmt(vals.length ? Math.max(...vals) : null, digits)})`;
    })
    .join(" ; ");

  const tip = cursor !== null && cursor < n ? cursor : null;
  const tipLeft = tip !== null ? px(xAt(tip)) : 0;

  return (
    <figure className="viz min-w-0" data-testid={testId}>
      <figcaption className="mb-1">
        <p className="text-sm font-medium">{title}</p>
        {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
      </figcaption>
      {series.length > 1 && (
        <ul className="mb-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs" aria-label="Légende">
          {series.map((s) => (
            <li key={s.key} className="text-muted-foreground flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn("inline-block", kind === "bars" ? "size-2.5 rounded-[2px]" : "h-0.5 w-3.5 rounded-full")}
                style={{ background: `var(--viz-${s.slot})` }}
              />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div ref={box} className="relative" style={{ height }}>
        {n === 0 ? (
          <p className="text-muted-foreground flex h-full items-center justify-center text-xs">
            En attente des premières mesures…
          </p>
        ) : (
          <>
            <svg
              width={W}
              height={height}
              role="img"
              aria-label={`${title}. ${description}`}
              tabIndex={0}
              className="block touch-none outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              onPointerMove={(e) => setCursor(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))}
              onPointerLeave={() => setCursor(null)}
              onBlur={() => setCursor(null)}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") setCursor((c) => Math.max(0, (c ?? n) - 1));
                else if (e.key === "ArrowRight") setCursor((c) => Math.min(n - 1, (c ?? n - 2) + 1));
                else if (e.key === "Escape") setCursor(null);
                else return;
                e.preventDefault();
              }}
            >
              {yTicks.map((t) => (
                <g key={t}>
                  <line
                    x1={MARGIN.l}
                    x2={W - MARGIN.r}
                    y1={py(t)}
                    y2={py(t)}
                    className="stroke-border"
                    strokeWidth={1}
                  />
                  <text x={MARGIN.l - 6} y={py(t) + 3.5} textAnchor="end" className="fill-muted-foreground text-[10px]">
                    {fmt(t, 1)}
                  </text>
                </g>
              ))}
              <text x={2} y={9} textAnchor="start" className="fill-muted-foreground text-[10px]">
                {unit}
              </text>
              {xTicks.map((t) => (
                <text
                  key={t}
                  x={px(t)}
                  y={height - 6}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px]"
                >
                  {clock(t)}
                </text>
              ))}

              {kind === "bars"
                ? xs.map((x, i) => {
                    let acc = 0;
                    return (
                      <g key={x} opacity={tip === null || tip === i ? 1 : 0.55}>
                        {series.map((s) => {
                          const v = s.values[i] ?? 0;
                          if (v <= 0) return null;
                          const y1 = py(acc);
                          const y2 = py(acc + v);
                          acc += v;
                          const h = Math.max(1, y1 - y2 - (acc > v ? GAP : 0));
                          return (
                            <rect
                              key={s.key}
                              x={px(x) - slot / 2}
                              y={y2}
                              width={slot}
                              height={h}
                              rx={Math.min(3, slot / 2)}
                              fill={`var(--viz-${s.slot})`}
                            />
                          );
                        })}
                      </g>
                    );
                  })
                : series.map((s) => (
                    <path
                      key={s.key}
                      d={linePath(
                        xs.map((x, i) => [x, s.values[i] ?? null]),
                        px,
                        py,
                      )}
                      fill="none"
                      stroke={`var(--viz-${s.slot})`}
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  ))}

              {thresholds.map((t) => (
                <g key={t.label}>
                  <line
                    x1={MARGIN.l}
                    x2={W - MARGIN.r}
                    y1={py(t.value)}
                    y2={py(t.value)}
                    className="stroke-muted-foreground"
                    strokeWidth={1}
                    strokeDasharray="4 3"
                  />
                  <text
                    x={W - MARGIN.r - 2}
                    y={py(t.value) - 3}
                    textAnchor="end"
                    className="fill-muted-foreground text-[10px]"
                    style={{ stroke: "var(--arc-surface)", strokeWidth: 3, paintOrder: "stroke" }}
                  >
                    {t.label}
                  </text>
                </g>
              ))}

              {tip !== null && (
                <g pointerEvents="none">
                  <line
                    x1={px(xAt(tip))}
                    x2={px(xAt(tip))}
                    y1={MARGIN.t}
                    y2={MARGIN.t + ph}
                    className="stroke-muted-foreground"
                    strokeWidth={1}
                  />
                  {kind === "line" &&
                    series.map((s) =>
                      s.values[tip] === null || s.values[tip] === undefined ? null : (
                        <circle
                          key={s.key}
                          cx={px(xAt(tip))}
                          cy={py(s.values[tip] as number)}
                          r={4}
                          fill={`var(--viz-${s.slot})`}
                          style={{ stroke: "var(--arc-surface)" }}
                          strokeWidth={2}
                        />
                      ),
                    )}
                </g>
              )}
            </svg>
            {tip !== null && (
              <div
                role="status"
                data-testid={testId ? `${testId}-tip` : undefined}
                className="bg-popover text-popover-foreground border-border pointer-events-none absolute top-1 z-10 min-w-32 rounded-lg border px-2.5 py-1.5 text-xs shadow-md"
                style={tipLeft > W * 0.6 ? { right: W - tipLeft + 12 } : { left: tipLeft + 12 }}
              >
                <p className="text-muted-foreground mb-0.5">{clock(xAt(tip))}</p>
                {series.map((s) => (
                  <p key={s.key} className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="inline-block h-0.5 w-3 rounded-full"
                      style={{ background: `var(--viz-${s.slot})` }}
                    />
                    <strong className="font-semibold tabular-nums">
                      {s.values[tip] == null ? "—" : `${fmt(s.values[tip], digits)} ${unit}`}
                    </strong>
                    <span className="text-muted-foreground">{s.label}</span>
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </figure>
  );
}

/** Width of a bar: up to 24 px, leaving air between neighbours. */
function bandWidth(n: number, plotWidth: number): number {
  if (n <= 1) return 12;
  return Math.max(2, Math.min(24, (plotWidth / n) * 0.7));
}
