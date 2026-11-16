import { Info } from "@/components/icons";

import { Switch } from "@/components/arc/switch/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSettingsStore } from "@/stores/settings-store";
import type { HeadsetMode, HeadsetSettings } from "@/types/audio";

import { Alert } from "./alert";
import { SettingRow, SettingsSection } from "./parts";

const MODES: Record<HeadsetMode, { label: string; help: string; disabled?: boolean }> = {
  auto: {
    label: "Automatic",
    help: "The best mechanism this system offers: the standard commands (HID telephony).",
  },
  system: {
    label: "Standard system commands",
    help: "The HID reports of the telephony page, without any other integration.",
  },
  vendor: {
    label: "Manufacturer integration (not available)",
    help: "No manufacturer integration is included: this choice handles no button.",
    disabled: true,
  },
  off: { label: "Disabled", help: "The headset buttons do nothing in ZePhone. The audio is not affected." },
};

export function HeadsetButtons() {
  const headset = useSettingsStore((s) => s.settings.audio.headset);
  const update = useSettingsStore((s) => s.update);
  const set = (patch: Partial<HeadsetSettings>) => void update({ audio: { headset: { ...headset, ...patch } } });
  const off = headset.mode === "off" || headset.mode === "vendor";

  return (
    <SettingsSection
      title="Headset buttons"
      description="Answer, hang up and mute from the headset. A headset can work perfectly for audio without its buttons being supported: the diagnostic says so headset by headset."
    >
      <SettingRow label="Button handling" htmlFor="headset-mode" stacked>
        <div className="space-y-1.5">
          <Select value={headset.mode} onValueChange={(v) => set({ mode: v as HeadsetMode })}>
            <SelectTrigger id="headset-mode" aria-label="Headset button handling" className="w-80 max-w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(MODES) as HeadsetMode[]).map((m) => (
                <SelectItem key={m} value={m} disabled={MODES[m].disabled && headset.mode !== m}>
                  {MODES[m].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">{MODES[headset.mode].help}</p>
        </div>
      </SettingRow>
      <SettingRow
        label="The call button answers"
        description="Only a call that is ringing. It never declines a call and never dials."
      >
        <Switch
          checked={headset.answer}
          disabled={off}
          onCheckedChange={(v) => set({ answer: v })}
          aria-label="Answer with the headset"
        />
      </SettingRow>
      <SettingRow
        label="Hang up with the headset"
        description="The call (or end) button ends the call in progress. Putting the headset on its stand does nothing if the headset does not announce it as a standard hang-up."
      >
        <Switch
          checked={headset.hangUp}
          disabled={off}
          onCheckedChange={(v) => set({ hangUp: v })}
          aria-label="Hang up with the headset"
        />
      </SettingRow>
      <SettingRow label="Mute the microphone with the headset" description="Short press. A long press is ignored.">
        <Switch
          checked={headset.mute}
          disabled={off}
          onCheckedChange={(v) => set({ mute: v })}
          aria-label="Mute the microphone with the headset"
        />
      </SettingRow>
      <SettingRow label="Put on hold with the headset" description="Only if the headset has a hold button.">
        <Switch
          checked={headset.hold}
          disabled={off}
          onCheckedChange={(v) => set({ hold: v })}
          aria-label="Hold with the headset"
        />
      </SettingRow>
      <SettingRow
        label="Only the headset used by ZePhone"
        description="Ignores the buttons of another headset, or of a headset that another application (Teams…) uses for its calls."
      >
        <Switch
          checked={headset.onlySelectedDevice}
          disabled={off}
          onCheckedChange={(v) => set({ onlySelectedDevice: v })}
          aria-label="Only the headset in use"
        />
      </SettingRow>
      <div className="space-y-2 px-4 py-3">
        <Alert>
          ZePhone only acts on the buttons if it has a call itself (ringing or in progress): open with no call, it does
          not react to anything. It does not take over the buttons: if Teams listens to the same headset, it will react
          too. macOS does not assign a headset's buttons to one particular application; to keep them from serving two
          applications, close the other application or choose “Disabled” in one of the two.
        </Alert>
        <p className="text-muted-foreground flex items-start gap-2 text-xs">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          If the headset has a hardware microphone mute, ZePhone can neither control nor observe it: ZePhone's “Muted”
          indicator does not reflect it.
        </p>
      </div>
    </SettingsSection>
  );
}
