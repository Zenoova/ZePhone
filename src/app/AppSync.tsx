import { useTheme } from "next-themes";
import { useEffect } from "react";

import { useSettingsStore } from "@/stores/settings-store";

export function ThemeSync() {
  const theme = useSettingsStore((s) => s.settings.general.theme);
  const { setTheme } = useTheme();
  useEffect(() => setTheme(theme), [theme, setTheme]);
  return null;
}

/** Frosted glass only makes sense where the native vibrancy exists (macOS). */
const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);

export function TranslucencySync() {
  const translucent = useSettingsStore((s) => s.settings.general.translucent);
  useEffect(() => {
    document.documentElement.classList.toggle("translucent", IS_MAC && translucent);
  }, [translucent]);
  return null;
}
