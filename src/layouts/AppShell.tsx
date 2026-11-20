import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";

import { Toaster } from "@/components/Toaster";
import { ActiveCallBar } from "@/features/calls/ActiveCallBar";
import { CallWindow } from "@/features/calls/CallWindow";
import { DirectoryPage } from "@/features/directory/DirectoryPage";
import { HomePage } from "@/features/home/HomePage";
import { HistoryPage } from "@/features/history/HistoryPage";
import { RecordingsPage } from "@/features/recordings/RecordingsPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { AccountsButton } from "@/features/accounts/AccountsPopover";
import { isIos, isMobile } from "@/lib/platform";
import { isTerminal, sortedCalls, useCallsStore } from "@/stores/calls-store";
import { type Section, useUiStore } from "@/stores/ui-store";

import { EngineBanner } from "./EngineBanner";
import { NAV_ITEMS } from "./nav";
import { NativeTabBar } from "./NativeTabBar";
import { NavDock } from "./NavDock";

const PAGES: Record<Section, () => React.JSX.Element> = {
  dialer: HomePage,
  contacts: DirectoryPage,
  history: HistoryPage,
  recordings: RecordingsPage,
  settings: SettingsPage,
};

/** ⌘1…⌘5 (Ctrl on Windows/Linux) switch sections. */
function useShellBehaviour() {
  const setSection = useUiStore((s) => s.setSection);

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
}

/**
 * A phone has one window: the call screen (the one a computer shows in its own window) covers the application for
 * as long as there is a call to show, until the user puts it away to use the rest of the application; a new call
 * brings it back.
 */
function MobileCallScreen() {
  const calls = useCallsStore(useShallow((s) => sortedCalls(s.calls)));
  const hidden = useUiStore((s) => s.callHidden);
  const setHidden = useUiStore((s) => s.setCallHidden);
  const liveIds = calls
    .filter((c) => !isTerminal(c))
    .map((c) => c.id)
    .join();

  useEffect(() => {
    if (liveIds) setHidden(false);
  }, [liveIds, setHidden]);

  if (calls.length === 0 || hidden) return null;
  return (
    <div
      className="bg-background fixed inset-0 z-40 pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]"
      data-testid="mobile-call-screen"
    >
      <CallWindow />
    </div>
  );
}

export function AppShell() {
  const section = useUiStore((s) => s.section);
  const Page = PAGES[section];
  useShellBehaviour();
  // An iPhone or an iPad navigates with the system's tab bar, and its pages need no room for a floating dock.
  const ios = isIos();
  useEffect(() => {
    if (ios) document.documentElement.dataset.nativeTabbar = "";
  }, [ios]);

  return (
    <>
      {/* The dock floats over the bottom of the page: what scrolls shows through its glass. */}
      <div className="relative h-full">
        <main className="flex h-full min-h-0 min-w-0 flex-col">
          <EngineBanner />
          <ActiveCallBar />
          <div className="min-h-0 flex-1 overflow-auto" key={section}>
            <Page />
          </div>
        </main>
        {ios ? (
          <>
            <NativeTabBar />
            <AccountsButton className="absolute top-1 right-3 z-20" />
          </>
        ) : (
          <NavDock />
        )}
      </div>
      {isMobile() && <MobileCallScreen />}
      <Toaster />
    </>
  );
}
