import { toast } from "@yusufceng1z/ding-react";

import { Button } from "@/components/arc/button/button";
import { Switch } from "@/components/ui/switch";
import { errorMessage, telephony } from "@/services/telephony";
import { useSettingsStore } from "@/stores/settings-store";

import { SettingRow, SettingsSection } from "./parts";

/** What ZePhone reports. Both switches start on. */
export function PrivacySettings() {
  const p = useSettingsStore((s) => s.settings.privacy);
  const update = useSettingsStore((s) => s.update);

  const resetId = async () => {
    try {
      await telephony.resetDiagnosticsId();
      toast.success("Anonymous identifier reset");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <SettingsSection
      title="Diagnostics"
      description="On by default. Never includes phone numbers, SIP addresses, names, passwords or anything said in a call."
    >
      <SettingRow
        label="Send crash reports"
        description="The error message, where it happened, the version and the system, when ZePhone crashes (Sentry)"
      >
        <Switch
          checked={p.crashReports}
          onCheckedChange={(v) => void update({ privacy: { crashReports: v, answered: true } })}
          aria-label="Send crash reports"
        />
      </SettingRow>
      <SettingRow
        label="Share anonymous usage statistics"
        description="That ZePhone was opened, and that an account or a call was made, with the version and the system (Google Analytics)"
      >
        <Switch
          checked={p.usageStats}
          onCheckedChange={(v) => void update({ privacy: { usageStats: v, answered: true } })}
          aria-label="Share anonymous usage statistics"
        />
      </SettingRow>
      <SettingRow
        label="Anonymous identifier"
        description="A random number that tells installations apart. Reset it at any time."
      >
        <Button type="button" variant="secondary" onClick={() => void resetId()}>
          Reset
        </Button>
      </SettingRow>
    </SettingsSection>
  );
}
