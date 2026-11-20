import { useEffect, useState } from "react";

import { nativeTabbar } from "@/lib/native-tabbar";
import { useCallsStore } from "@/stores/calls-store";
import { countUnseenMissed, useHistoryStore } from "@/stores/history-store";
import { type Section, useUiStore } from "@/stores/ui-store";

import { NAV_ITEMS } from "./nav";

/** SF Symbol of each section (Android draws its own icons, by id, in `res/drawable`). */
const SYMBOLS: Record<Section, string> = {
  dialer: "circle.grid.3x3.fill",
  contacts: "person.2.fill",
  history: "clock.fill",
  recordings: "waveform",
  settings: "gearshape.fill",
};

/**
 * The navigation of an iPhone or an iPad: the system's own tab bar, drawn natively (Liquid Glass from iOS 26) under the
 * page. This component draws nothing: it describes the tabs to the shell, follows the taps, and keeps the selection,
 * the missed-call badge and the visibility (the bar goes away behind the call screen) in step with the page.
 */
export function NativeTabBar() {
  const section = useUiStore((s) => s.section);
  const setSection = useUiStore((s) => s.setSection);
  const hasCalls = useCallsStore((s) => Object.keys(s.calls).length > 0);
  const callHidden = useUiStore((s) => s.callHidden);
  const callScreenShown = hasCalls && !callHidden;
  const unseenMissed = useHistoryStore((s) => countUnseenMissed(s.entries, s.seenAt));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let off: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      off = await nativeTabbar.onSelected((id) => setSection(id as Section));
      await nativeTabbar.install(NAV_ITEMS.map((n) => ({ id: n.id, title: n.label, symbol: SYMBOLS[n.id] })));
      if (!cancelled) setReady(true);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
      off?.();
    };
  }, [setSection]);

  useEffect(() => {
    if (ready) void nativeTabbar.select(section).catch(() => undefined);
  }, [ready, section]);

  useEffect(() => {
    if (ready) void nativeTabbar.badge("history", unseenMissed).catch(() => undefined);
  }, [ready, unseenMissed]);

  useEffect(() => {
    if (ready) void nativeTabbar.visible(!callScreenShown).catch(() => undefined);
  }, [ready, callScreenShown]);

  return null;
}
