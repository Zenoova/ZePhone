import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "@/stores/settings-store";

import { SettingRow, SettingsSection } from "./parts";

export function NotificationSettings() {
  const n = useSettingsStore((s) => s.settings.notifications);
  const update = useSettingsStore((s) => s.update);
  return (
    <div className="space-y-6">
      <SettingsSection title="Notifications" description="L'appel entrant s'affiche toujours dans l'application, même si la fenêtre était réduite.">
        <SettingRow label="Notification système pour un appel entrant" description="Notification native du système à l'arrivée d'un appel">
          <Switch
            checked={n.incomingCall}
            onCheckedChange={(v) => void update({ notifications: { incomingCall: v } })}
            aria-label="Notification pour un appel entrant"
          />
        </SettingRow>
        <SettingRow label="Notification pour un appel manqué">
          <Switch
            checked={n.missedCall}
            onCheckedChange={(v) => void update({ notifications: { missedCall: v } })}
            aria-label="Notification pour un appel manqué"
          />
        </SettingRow>
        <SettingRow label="Sonnerie" description="Joue une sonnerie sur la sortie audio choisie pendant un appel entrant">
          <Switch
            checked={n.ringtone}
            onCheckedChange={(v) => void update({ notifications: { ringtone: v } })}
            aria-label="Sonnerie"
          />
        </SettingRow>
      </SettingsSection>
    </div>
  );
}
