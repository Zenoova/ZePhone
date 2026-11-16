import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "@/stores/settings-store";

import { SettingRow, SettingsSection } from "./parts";

export function NotificationSettings() {
  const n = useSettingsStore((s) => s.settings.notifications);
  const g = useSettingsStore((s) => s.settings.general);
  const update = useSettingsStore((s) => s.update);
  return (
    <div className="space-y-6">
      <SettingsSection title="Availability">
        <SettingRow
          label="Do not disturb"
          description="Incoming calls are declined (486 “Busy”) without ringing or notifying. They stay in the history, as missed. The calls you make are not affected."
        >
          <Switch
            checked={g.doNotDisturb}
            onCheckedChange={(v) => void update({ general: { doNotDisturb: v } })}
            aria-label="Do not disturb"
          />
        </SettingRow>
      </SettingsSection>
      <SettingsSection
        title="Notifications"
        description="The incoming call is always shown in the application, even if the window was minimized."
      >
        <SettingRow
          label="System notification for an incoming call"
          description="Native system notification when a call arrives"
        >
          <Switch
            checked={n.incomingCall}
            onCheckedChange={(v) => void update({ notifications: { incomingCall: v } })}
            aria-label="Notification for an incoming call"
          />
        </SettingRow>
        <SettingRow label="Notification for a missed call">
          <Switch
            checked={n.missedCall}
            onCheckedChange={(v) => void update({ notifications: { missedCall: v } })}
            aria-label="Notification for a missed call"
          />
        </SettingRow>
        <SettingRow label="Ringtone" description="Plays a ringtone on the chosen audio output during an incoming call">
          <Switch
            checked={n.ringtone}
            onCheckedChange={(v) => void update({ notifications: { ringtone: v } })}
            aria-label="Ringtone"
          />
        </SettingRow>
      </SettingsSection>
    </div>
  );
}
