import { RadioGroup } from "radix-ui";
import { useState } from "react";

import { ClassicVoiceOrb } from "@/components/ClassicVoiceOrb";
import { ShaderVoiceOrb } from "@/components/ShaderVoiceOrb";
import { VOICE_ORBS, findVoiceOrb } from "@/lib/voice-orbs";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";

/** A live preview of one orb, in its "speaking" look (the classic bubble has no such look: it breathes). */
function OrbPreview({ orb }: { orb: string }) {
  const entry = findVoiceOrb(orb);
  return entry.load ? (
    <ShaderVoiceOrb orb={entry.id} callId="" source="rx" demo />
  ) : (
    <ClassicVoiceOrb callId="" source="rx" tone="remote" vivid />
  );
}

/**
 * Choose the voice orb. One live preview (hover or focus an orb to try it), a list to pick from; the choice
 * applies at once to the orbs of the call screen and is remembered.
 */
export function OrbPicker() {
  const chosen = findVoiceOrb(useSettingsStore((s) => s.settings.general.voiceOrb)).id;
  const update = useSettingsStore((s) => s.update);
  const [peek, setPeek] = useState<string | null>(null);
  const shown = findVoiceOrb(peek ?? chosen);

  return (
    <div className="flex flex-col gap-3" data-testid="orb-picker">
      <div>
        <h2 className="text-sm font-semibold">Orbe vocal</h2>
        <p className="text-muted-foreground text-xs">Il s'anime avec les voix pendant vos appels.</p>
      </div>

      <div className="mx-auto size-36" aria-hidden>
        <OrbPreview key={shown.id} orb={shown.id} />
      </div>
      <p className="text-muted-foreground -mt-1 text-center text-xs" aria-live="polite">
        <span className="text-foreground font-medium">{shown.label}</span> · {shown.hint}
      </p>

      <RadioGroup.Root
        value={chosen}
        onValueChange={(id) => void update({ general: { voiceOrb: id } })}
        aria-label="Orbe vocal"
        className="grid max-h-56 grid-cols-2 gap-1.5 overflow-y-auto pr-0.5"
        onMouseLeave={() => setPeek(null)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setPeek(null);
        }}
      >
        {VOICE_ORBS.map((o) => (
          <RadioGroup.Item
            key={o.id}
            value={o.id}
            title={o.hint}
            onMouseEnter={() => setPeek(o.id)}
            onFocus={() => setPeek(o.id)}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-sm transition-colors outline-none",
              "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
              "hover:bg-accent/60 data-[state=checked]:border-primary data-[state=checked]:bg-primary/15 data-[state=checked]:font-medium",
            )}
          >
            <span
              aria-hidden
              className="border-primary/60 data-[checked=true]:bg-primary size-2 shrink-0 rounded-full border"
              data-checked={o.id === chosen}
            />
            <span className="truncate">{o.label}</span>
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    </div>
  );
}
