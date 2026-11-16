import { AudioLines, Grid3x3, History, Settings, Users, type AppIcon } from "@/components/icons";

import type { Section } from "@/stores/ui-store";

interface NavItem {
  id: Section;
  label: string;
  icon: AppIcon;
  shortcut: string;
}

export const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { id: "dialer", label: "Keypad", icon: Grid3x3, shortcut: "1" },
  { id: "contacts", label: "Directory", icon: Users, shortcut: "2" },
  { id: "history", label: "History", icon: History, shortcut: "3" },
  { id: "recordings", label: "Recordings", icon: AudioLines, shortcut: "4" },
  { id: "settings", label: "Settings", icon: Settings, shortcut: "5" },
];
