import { OrbPicker } from "@/components/OrbPicker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { hasNativeTabBar, isMobile } from "@/lib/platform";
import { useSettingsStore } from "@/stores/settings-store";
import type { Theme } from "@/types/telephony";

import { SettingRow, SettingsSection } from "./parts";
import { PrivacySettings } from "./PrivacySettings";

const THEMES: Record<Theme, string> = { system: "Automatic (system)", light: "Light", dark: "Dark" };

export function GeneralSettings() {
  const g = useSettingsStore((s) => s.settings.general);
  const update = useSettingsStore((s) => s.update);
  const isMac = navigator.userAgent.includes("Mac");
  // Starting at login, the tray icon and a window to close are a computer's: a phone's system starts and keeps the
  // application as it needs.
  const mobile = isMobile();

  return (
    <div className="space-y-6">
      <SettingsSection title="Apparence">
        <SettingRow label="Theme" htmlFor="theme">
          <Select value={g.theme} onValueChange={(v) => void update({ general: { theme: v as Theme } })}>
            <SelectTrigger id="theme" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(THEMES) as Theme[]).map((t) => (
                <SelectItem key={t} value={t}>
                  {THEMES[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      </SettingsSection>

      {/* On a computer the dock's orb opens this choice; the system's navigation bar of a phone has no room for it. */}
      {hasNativeTabBar() && (
        <SettingsSection title="Voice orb">
          <div className="flex justify-center py-2">
            <OrbPicker />
          </div>
        </SettingsSection>
      )}

      {isMac && (
        <SettingsSection title="Window">
          <SettingRow
            label="Translucent background (glass effect)"
            description="Lets the desktop show through behind the window, like recent macOS apps"
          >
            <Switch
              checked={g.translucent}
              onCheckedChange={(v) => void update({ general: { translucent: v } })}
              aria-label="Translucent background"
            />
          </SettingRow>
        </SettingsSection>
      )}

      {!mobile && (
        <SettingsSection title="Startup and window">
          <SettingRow label="Launch ZePhone at login" description="To receive calls as soon as you sign in">
            <Switch
              checked={g.launchAtLogin}
              onCheckedChange={(v) => void update({ general: { launchAtLogin: v } })}
              aria-label="Launch at login"
            />
          </SettingRow>
          <SettingRow label="Start minimized" description="Do not show the window at launch">
            <Switch
              checked={g.startMinimized}
              onCheckedChange={(v) => void update({ general: { startMinimized: v } })}
              aria-label="Start minimized"
            />
          </SettingRow>
          <SettingRow label={isMac ? "Menu bar icon" : "Notification area icon"}>
            <Switch
              checked={g.showTrayIcon}
              onCheckedChange={(v) => void update({ general: { showTrayIcon: v } })}
              aria-label="Show the menu bar icon"
            />
          </SettingRow>
          <SettingRow
            label="Keep ZePhone running when the window is closed"
            description="Incoming calls are still received as long as the application is running and registered. Requires the icon above."
          >
            <Switch
              checked={g.closeToTray && g.showTrayIcon}
              disabled={!g.showTrayIcon}
              onCheckedChange={(v) => void update({ general: { closeToTray: v } })}
              aria-label="Keep running when the window is closed"
            />
          </SettingRow>
        </SettingsSection>
      )}

      <PrivacySettings />
    </div>
  );
}
