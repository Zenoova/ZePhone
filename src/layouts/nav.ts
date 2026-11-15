import { Grid3x3, History, Settings, Users, type AppIcon } from "@/components/icons";

import type { Section } from "@/stores/ui-store";

interface NavItem {
  id: Section;
  label: string;
  icon: AppIcon;
  shortcut: string;
}

export const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { id: "dialer", label: "Clavier", icon: Grid3x3, shortcut: "1" },
  { id: "contacts", label: "Contacts", icon: Users, shortcut: "2" },
  { id: "history", label: "Historique", icon: History, shortcut: "3" },
  { id: "settings", label: "Paramètres", icon: Settings, shortcut: "4" },
];
