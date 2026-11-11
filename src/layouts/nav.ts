import { Grip, History, Settings, Users, type LucideIcon } from "lucide-react";

import type { Section } from "@/stores/ui-store";

interface NavItem {
  id: Section;
  label: string;
  icon: LucideIcon;
  shortcut: string;
}

export const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { id: "dialer", label: "Clavier", icon: Grip, shortcut: "1" },
  { id: "contacts", label: "Contacts", icon: Users, shortcut: "2" },
  { id: "history", label: "Historique", icon: History, shortcut: "3" },
  { id: "settings", label: "Paramètres", icon: Settings, shortcut: "4" },
];
