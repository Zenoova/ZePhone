import { useState } from "react";

import FluidSlider from "@/components/ui/fluid-slider";
import { telephony } from "@/services/telephony";
import { useSettingsStore } from "@/stores/settings-store";

/** The live change is sent to the engine at most this often while the slider is dragged. */
const LIVE_EVERY_MS = 60;

const percent = (v: number) => `${Math.round(v)}%`;

let lastSent = 0;

/** Sends the volumes to the engine, at most every `LIVE_EVERY_MS` unless `force`d. */
function sendLive(input: number, output: number, force = false) {
  const now = performance.now();
  if (!force && now - lastSent < LIVE_EVERY_MS) return;
  lastSent = now;
  // Not being in a call (or in a browser preview) is not an error here: the settings keep the value.
  void telephony.setAudioGains(Math.round(input), Math.round(output)).catch(() => {});
}

/**
 * The incoming and outgoing volumes. Dragging changes the sound of the call in progress at once; letting go
 * saves the value, so it applies to the next calls too.
 */
export function VolumeSliders({ className }: { className?: string }) {
  const stored = useSettingsStore((s) => s.settings.audio);
  const update = useSettingsStore((s) => s.update);
  const [drag, setDrag] = useState<{ input?: number; output?: number }>({});

  const current = { input: drag.input ?? stored.inputGain, output: drag.output ?? stored.outputGain };

  return (
    <div className={className} data-testid="volume-sliders">
      <div className="flex flex-col gap-3">
        <FluidSlider
          className="max-w-none"
          label="Incoming sound"
          ariaLabel="Incoming sound volume (what you hear)"
          min={0}
          max={200}
          step={1}
          largeStep={10}
          marks={[100]}
          value={current.output}
          formatValue={percent}
          onValueChange={(v) => {
            setDrag((d) => ({ ...d, output: v }));
            sendLive(current.input, v);
          }}
          onValueCommitted={(v) => {
            sendLive(current.input, v, true);
            setDrag((d) => ({ ...d, output: undefined }));
            void update({ audio: { outputGain: Math.round(v) } });
          }}
        />
        <FluidSlider
          className="max-w-none"
          label="Outgoing sound"
          ariaLabel="Outgoing sound volume (what your correspondent hears)"
          min={0}
          max={200}
          step={1}
          largeStep={10}
          marks={[100]}
          value={current.input}
          formatValue={percent}
          onValueChange={(v) => {
            setDrag((d) => ({ ...d, input: v }));
            sendLive(v, current.output);
          }}
          onValueCommitted={(v) => {
            sendLive(v, current.output, true);
            setDrag((d) => ({ ...d, input: undefined }));
            void update({ audio: { inputGain: Math.round(v) } });
          }}
        />
      </div>
    </div>
  );
}
