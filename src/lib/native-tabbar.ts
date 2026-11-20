import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** One tab of the system's navigation bar (`UITabBar`): the section it opens, its title and an SF Symbol. */
export interface NativeTab {
  id: string;
  title: string;
  symbol: string;
}

/** Event the shell emits when the user taps a tab; the payload is the tab's id. */
export const TAB_SELECTED_EVENT = "native-tab-selected";

export const nativeTabbar = {
  install: (tabs: NativeTab[]) => invoke<void>("native_tabbar_install", { tabs }),
  select: (id: string) => invoke<void>("native_tabbar_select", { id }),
  badge: (id: string, count: number) => invoke<void>("native_tabbar_badge", { id, count }),
  visible: (visible: boolean) => invoke<void>("native_tabbar_visible", { visible }),
  onSelected: (handler: (id: string) => void): Promise<UnlistenFn> =>
    listen<string>(TAB_SELECTED_EVENT, (e) => handler(e.payload)),
};
