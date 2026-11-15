import { ClassicVoiceOrb, type VoiceOrbProps } from "@/components/ClassicVoiceOrb";
import { ShaderVoiceOrb } from "@/components/ShaderVoiceOrb";
import { findVoiceOrb } from "@/lib/voice-orbs";
import { useSettingsStore } from "@/stores/settings-store";

export type { OrbTone, VoiceOrbProps } from "@/components/ClassicVoiceOrb";

/**
 * A voice of the call, drawn with the orb the user picked (click the orb at the top left of the window):
 * ZePhone's own bubble or one of the OrbKit shader orbs. `orb` overrides the choice (previews).
 */
export function VoiceOrb({ orb, ...props }: VoiceOrbProps & { orb?: string }) {
  const chosen = useSettingsStore((s) => s.settings.general.voiceOrb);
  const entry = findVoiceOrb(orb ?? chosen);
  return entry.load ? <ShaderVoiceOrb {...props} orb={entry.id} /> : <ClassicVoiceOrb {...props} />;
}
