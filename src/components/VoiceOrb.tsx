import { ShaderVoiceOrb, type ShaderVoiceOrbProps } from "@/components/ShaderVoiceOrb";
import { findVoiceOrb } from "@/lib/voice-orbs";
import { useSettingsStore } from "@/stores/settings-store";

/**
 * The voice of the person we talk to, drawn with the orb the user picked (click the orb at the top left of the
 * window). `orb` overrides the choice.
 */
export function VoiceOrb({ orb, ...props }: Omit<ShaderVoiceOrbProps, "orb"> & { orb?: string }) {
  const chosen = useSettingsStore((s) => s.settings.general.voiceOrb);
  return <ShaderVoiceOrb {...props} orb={findVoiceOrb(orb ?? chosen).id} />;
}
