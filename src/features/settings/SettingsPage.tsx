import { Bell, Info, Network, SlidersHorizontal, UserRound, Volume2 } from "@/components/icons";

import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import { type SettingsTab, useUiStore } from "@/stores/ui-store";

import { AboutSettings } from "./AboutSettings";
import { AccountsSettings } from "./AccountsSettings";
import { AudioSettings } from "./AudioSettings";
import { GeneralSettings } from "./GeneralSettings";
import { NetworkSettings } from "./NetworkSettings";
import { NotificationSettings } from "./NotificationSettings";

const TABS: ReadonlyArray<{ id: SettingsTab; label: string; icon: typeof Bell }> = [
  { id: "accounts", label: "Comptes SIP", icon: UserRound },
  { id: "audio", label: "Audio", icon: Volume2 },
  { id: "network", label: "Réseau", icon: Network },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "general", label: "Général", icon: SlidersHorizontal },
  { id: "about", label: "À propos", icon: Info },
];

export function SettingsPage() {
  const tab = useUiStore((s) => s.settingsTab);
  const openSettings = useUiStore((s) => s.openSettings);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Paramètres" />
      <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row md:gap-6 md:px-6">
        <nav
          aria-label="Catégories de paramètres"
          className="flex gap-1 overflow-x-auto px-4 md:w-48 md:shrink-0 md:flex-col md:overflow-visible md:px-0"
        >
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={tab === id ? "page" : undefined}
              onClick={() => openSettings(id)}
              className={cn(
                "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors outline-none",
                "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
                tab === id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 md:px-0 md:pr-2">
          <div className="mx-auto max-w-2xl">
            {tab === "accounts" && <AccountsSettings />}
            {tab === "audio" && <AudioSettings />}
            {tab === "network" && <NetworkSettings />}
            {tab === "notifications" && <NotificationSettings />}
            {tab === "general" && <GeneralSettings />}
            {tab === "about" && <AboutSettings />}
          </div>
        </div>
      </div>
    </div>
  );
}
