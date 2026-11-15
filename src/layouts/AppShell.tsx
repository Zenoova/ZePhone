import { useEffect, useRef } from "react";

import { Toaster } from "@/components/Toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ActiveCallBar } from "@/features/calls/ActiveCallBar";
import { IncomingCallDialog } from "@/features/calls/IncomingCallDialog";
import { ContactsPage } from "@/features/contacts/ContactsPage";
import { HomePage } from "@/features/home/HomePage";
import { HistoryPage } from "@/features/history/HistoryPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { useCallsStore } from "@/stores/calls-store";
import { type Section, useUiStore } from "@/stores/ui-store";

import { EngineBanner } from "./EngineBanner";
import { NAV_ITEMS } from "./nav";
import { NavDock } from "./NavDock";
import { StatusBar } from "./StatusBar";

const PAGES: Record<Section, () => React.JSX.Element> = {
  dialer: HomePage,
  contacts: ContactsPage,
  history: HistoryPage,
  settings: SettingsPage,
};

/** ⌘1…⌘4 (Ctrl on Windows/Linux) switch sections; a new call brings the keypad page, which then shows the call. */
function useShellBehaviour() {
  const setSection = useUiStore((s) => s.setSection);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const item = NAV_ITEMS.find((n) => n.shortcut === e.key);
      if (item) {
        e.preventDefault();
        setSection(item.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSection]);

  useEffect(
    () =>
      useCallsStore.subscribe((state) => {
        for (const call of Object.values(state.calls)) {
          if (seen.current.has(call.id)) continue;
          seen.current.add(call.id);
          // The call screen lives on the keypad page: show it as soon as a call starts.
          if (call.state !== "incoming") setSection("dialer");
        }
      }),
    [setSection],
  );
}

export function AppShell() {
  const section = useUiStore((s) => s.section);
  const Page = PAGES[section];
  useShellBehaviour();

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col">
        {/* The dock floats over the bottom of the page: what scrolls shows through its glass. */}
        <div className="relative min-h-0 flex-1">
          <main className="flex h-full min-h-0 min-w-0 flex-col">
            <EngineBanner />
            <ActiveCallBar />
            <div className="min-h-0 flex-1 overflow-auto" key={section}>
              <Page />
            </div>
          </main>
          <NavDock />
        </div>
        <StatusBar />
      </div>
      <IncomingCallDialog />
      <Toaster />
    </TooltipProvider>
  );
}
