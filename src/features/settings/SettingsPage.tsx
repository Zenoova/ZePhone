import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsList, TabsTrigger } from "@/components/arc/tabs/tabs";
import { type SettingsTab, useUiStore } from "@/stores/ui-store";

import { AboutSettings } from "./AboutSettings";
import { AccountsSettings } from "./AccountsSettings";
import { AudioSettings } from "./AudioSettings";
import { DirectorySettings } from "./DirectorySettings";
import { GeneralSettings } from "./GeneralSettings";
import { NetworkSettings } from "./NetworkSettings";
import { NotificationSettings } from "./NotificationSettings";
import { ShortcutsSettings } from "./ShortcutsSettings";

const TABS: ReadonlyArray<{ id: SettingsTab; label: string }> = [
  { id: "accounts", label: "Comptes SIP" },
  { id: "directory", label: "Annuaire" },
  { id: "audio", label: "Audio" },
  { id: "network", label: "Réseau" },
  { id: "notifications", label: "Notifications" },
  { id: "shortcuts", label: "Raccourcis" },
  { id: "general", label: "Général" },
  { id: "about", label: "À propos" },
];

export function SettingsPage() {
  const tab = useUiStore((s) => s.settingsTab);
  const openSettings = useUiStore((s) => s.openSettings);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Paramètres" />
      <div className="px-6 pb-3">
        <Tabs value={tab} onValueChange={(v) => openSettings(v as SettingsTab)}>
          <TabsList aria-label="Catégories de paramètres">
            {TABS.map(({ id, label }) => (
              <TabsTrigger key={id} value={id}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-28">
        <div className="mx-auto max-w-2xl">
          {tab === "accounts" && <AccountsSettings />}
          {tab === "directory" && <DirectorySettings />}
          {tab === "audio" && <AudioSettings />}
          {tab === "network" && <NetworkSettings />}
          {tab === "notifications" && <NotificationSettings />}
          {tab === "shortcuts" && <ShortcutsSettings />}
          {tab === "general" && <GeneralSettings />}
          {tab === "about" && <AboutSettings />}
        </div>
      </div>
    </div>
  );
}
