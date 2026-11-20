import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { isAndroid } from "@/lib/platform";

/** One tab of the system's navigation bar (`UITabBar`): the section it opens, its title and an SF Symbol. */
export interface NativeTab {
  id: string;
  title: string;
  symbol: string;
}

/** Event the shell emits when the user taps a tab; the payload is the tab's id. */
export const TAB_SELECTED_EVENT = "native-tab-selected";

/**
 * What the Android shell (`MainActivity.kt`) puts on the page: the navigation bar's controls, and a function the shell calls
 * when a tab is tapped. Nothing else of the page is reachable from it.
 */
interface AndroidBridge {
  install(tabsJson: string): void;
  select(id: string): void;
  badge(id: string, count: number): void;
  visible(visible: boolean): void;
}
declare global {
  interface Window {
    ZephoneNative?: AndroidBridge;
    __zephoneNativeTab?: (id: string) => void;
  }
}

const android = (): AndroidBridge | undefined => (isAndroid() ? window.ZephoneNative : undefined);

/** iOS: Tauri commands to the shell and an event back. Android: the shell's own bridge on the page. */
export const nativeTabbar = {
  install: async (tabs: NativeTab[]) => {
    const bridge = android();
    if (bridge) return bridge.install(JSON.stringify(tabs));
    return invoke<void>("native_tabbar_install", { tabs });
  },
  select: async (id: string) => {
    const bridge = android();
    if (bridge) return bridge.select(id);
    return invoke<void>("native_tabbar_select", { id });
  },
  badge: async (id: string, count: number) => {
    const bridge = android();
    if (bridge) return bridge.badge(id, count);
    return invoke<void>("native_tabbar_badge", { id, count });
  },
  visible: async (visible: boolean) => {
    const bridge = android();
    if (bridge) return bridge.visible(visible);
    return invoke<void>("native_tabbar_visible", { visible });
  },
  onSelected: async (handler: (id: string) => void): Promise<UnlistenFn> => {
    if (isAndroid()) {
      window.__zephoneNativeTab = handler;
      return () => {
        if (window.__zephoneNativeTab === handler) delete window.__zephoneNativeTab;
      };
    }
    return listen<string>(TAB_SELECTED_EVENT, (e) => handler(e.payload));
  },
};
