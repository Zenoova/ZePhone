import { useEffect, useRef } from "react";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ActiveCallBar } from "@/features/calls/ActiveCallBar";
import { CallsPage } from "@/features/calls/CallsPage";
import { IncomingCallDialog } from "@/features/calls/IncomingCallDialog";
import { ContactsPage } from "@/features/contacts/ContactsPage";
import { DialerPage } from "@/features/dialer/DialerPage";
import { HistoryPage } from "@/features/history/HistoryPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { shouldReturnToDialer } from "@/lib/call-flow";
import { useCallsStore } from "@/stores/calls-store";
import { type Section, useUiStore } from "@/stores/ui-store";

import { EngineBanner } from "./EngineBanner";
import { NAV_ITEMS } from "./nav";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";

const PAGES: Record<Section, () => React.JSX.Element> = {
  dialer: DialerPage,
  calls: CallsPage,
  contacts: ContactsPage,
  history: HistoryPage,
  settings: SettingsPage,
};

/** ⌘1…⌘5 (Ctrl on Windows/Linux) switch sections; new calls open the call screen, the end of the last one returns to the keypad. */
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
      useCallsStore.subscribe((state, prev) => {
        for (const call of Object.values(state.calls)) {
          if (seen.current.has(call.id)) continue;
          seen.current.add(call.id);
          if (call.state !== "incoming") setSection("calls");
        }
        // Back to the keypad once the last call is over.
        if (shouldReturnToDialer(prev.calls, state.calls, useUiStore.getState().section)) setSection("dialer");
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
      <div className="flex h-full flex-col-reverse sm:flex-row">
        <Sidebar />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <EngineBanner />
          <ActiveCallBar />
          <div className="min-h-0 flex-1 overflow-auto" key={section}>
            <Page />
          </div>
          <StatusBar />
        </main>
      </div>
      <IncomingCallDialog />
      <Toaster position="top-center" richColors closeButton />
    </TooltipProvider>
  );
}
