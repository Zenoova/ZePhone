import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "@/stores/settings-store";
import type { Theme } from "@/types/telephony";

import { SettingRow, SettingsSection } from "./parts";

const THEMES: Record<Theme, string> = { system: "Automatique (système)", light: "Clair", dark: "Sombre" };

export function GeneralSettings() {
  const g = useSettingsStore((s) => s.settings.general);
  const update = useSettingsStore((s) => s.update);
  const isMac = navigator.userAgent.includes("Mac");

  return (
    <div className="space-y-6">
      <SettingsSection title="Apparence">
        <SettingRow label="Thème" htmlFor="theme">
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

      <SettingsSection title="Démarrage et fenêtre">
        <SettingRow
          label="Lancer ZePhone à l'ouverture de session"
          description="Pour recevoir les appels dès que vous vous connectez"
        >
          <Switch
            checked={g.launchAtLogin}
            onCheckedChange={(v) => void update({ general: { launchAtLogin: v } })}
            aria-label="Lancer à l'ouverture de session"
          />
        </SettingRow>
        <SettingRow label="Démarrer réduit" description="Ne pas afficher la fenêtre au lancement">
          <Switch
            checked={g.startMinimized}
            onCheckedChange={(v) => void update({ general: { startMinimized: v } })}
            aria-label="Démarrer réduit"
          />
        </SettingRow>
        <SettingRow label={isMac ? "Icône dans la barre des menus" : "Icône dans la zone de notification"}>
          <Switch
            checked={g.showTrayIcon}
            onCheckedChange={(v) => void update({ general: { showTrayIcon: v } })}
            aria-label="Afficher l'icône de la barre des menus"
          />
        </SettingRow>
        <SettingRow
          label="Garder ZePhone actif à la fermeture de la fenêtre"
          description="Les appels entrants restent reçus tant que l'application est active et enregistrée. Nécessite l'icône ci-dessus."
        >
          <Switch
            checked={g.closeToTray && g.showTrayIcon}
            disabled={!g.showTrayIcon}
            onCheckedChange={(v) => void update({ general: { closeToTray: v } })}
            aria-label="Garder actif à la fermeture"
          />
        </SettingRow>
      </SettingsSection>
    </div>
  );
}
