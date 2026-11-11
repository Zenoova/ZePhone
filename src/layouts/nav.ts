import { Grip, History, PhoneCall, Settings, Users, type LucideIcon } from "lucide-react";

import type { Section } from "@/stores/ui-store";

interface NavItem {
  id: Section;
  label: string;
  icon: LucideIcon;
  shortcut: string;
}

export const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { id: "dialer", label: "Clavier", icon: Grip, shortcut: "1" },
  { id: "calls", label: "Appels", icon: PhoneCall, shortcut: "2" },
  { id: "contacts", label: "Contacts", icon: Users, shortcut: "3" },
  { id: "history", label: "Historique", icon: History, shortcut: "4" },
  { id: "settings", label: "Paramètres", icon: Settings, shortcut: "5" },
];
