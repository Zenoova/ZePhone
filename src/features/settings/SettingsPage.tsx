import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsList, TabsTrigger } from "@/components/arc/tabs/tabs";
import { isMobile } from "@/lib/platform";
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
  { id: "accounts", label: "SIP accounts" },
  { id: "directory", label: "Directory" },
  { id: "audio", label: "Audio" },
  { id: "network", label: "Network" },
  { id: "notifications", label: "Notifications" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "general", label: "General" },
  { id: "about", label: "About" },
];

/** What only makes sense with a keyboard and a desktop: a phone has no global shortcuts. */
const DESKTOP_ONLY: ReadonlySet<SettingsTab> = new Set(["shortcuts"]);

export function SettingsPage() {
  const tab = useUiStore((s) => s.settingsTab);
  const openSettings = useUiStore((s) => s.openSettings);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Settings" />
      <div className="px-6 pb-3">
        <Tabs value={tab} onValueChange={(v) => openSettings(v as SettingsTab)}>
          <TabsList aria-label="Settings categories">
            {TABS.filter(({ id }) => !(isMobile() && DESKTOP_ONLY.has(id))).map(({ id, label }) => (
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
