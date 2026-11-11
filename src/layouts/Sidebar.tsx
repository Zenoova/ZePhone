import { cn } from "@/lib/utils";
import { VoiceOrb } from "@/components/VoiceOrb";
import { isTerminal, useCallsStore } from "@/stores/calls-store";
import { countUnseenMissed, useHistoryStore } from "@/stores/history-store";
import { useUiStore } from "@/stores/ui-store";

import { NAV_ITEMS } from "./nav";

/**
 * The logo is the voice of the person we are talking to — and, between calls, the same living shape
 * at rest. Clicking it brings the keypad page (which shows the call when there is one).
 */
function SidebarOrb() {
  const setSection = useUiStore((s) => s.setSection);
  const callId = useCallsStore((s) => Object.values(s.calls).find((c) => !isTerminal(c))?.id ?? "");
  return (
    <button
      type="button"
      onClick={() => setSection("dialer")}
      aria-label="ZePhone : clavier et appel en cours"
      title="Clavier / appel en cours"
      data-testid="sidebar-orb"
      data-in-call={callId !== ""}
      className="focus-visible:ring-ring/50 hidden items-center gap-2.5 rounded-2xl px-3 pt-4 pb-3 text-left outline-none focus-visible:ring-[3px] sm:flex sm:justify-center lg:justify-start"
    >
      <span className="block size-11 shrink-0">
        <VoiceOrb callId={callId} source="rx" tone="remote" vivid />
      </span>
      <span className="hidden text-lg font-semibold tracking-tight lg:inline">ZePhone</span>
    </button>
  );
}

function Badge({ count, tone }: { count: number; tone: "success" | "destructive" }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} en attente`}
      className={cn(
        "absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-4 font-semibold text-white sm:top-1.5 sm:right-2 lg:static lg:ml-auto",
        tone === "success" ? "bg-success" : "bg-destructive",
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function Sidebar() {
  const section = useUiStore((s) => s.section);
  const setSection = useUiStore((s) => s.setSection);
  const unseenMissed = useHistoryStore((s) => countUnseenMissed(s.entries, s.seenAt));

  return (
    <nav
      aria-label="Navigation principale"
      className="bg-sidebar text-sidebar-foreground border-sidebar-border flex shrink-0 border-t sm:w-16 sm:flex-col sm:border-t-0 sm:border-r lg:w-56"
    >
      <SidebarOrb />
      <ul className="flex flex-1 justify-around gap-1 p-1.5 sm:flex-col sm:justify-start sm:p-2">
        {NAV_ITEMS.map(({ id, label, icon: Icon, shortcut }) => {
          const active = section === id;
          return (
            <li key={id} className="flex-1 sm:flex-none">
              <button
                type="button"
                onClick={() => setSection(id)}
                aria-current={active ? "page" : undefined}
                aria-label={label}
                title={`${label} (⌘${shortcut})`}
                className={cn(
                  "relative flex w-full flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 text-[11px] font-medium transition-colors outline-none",
                  "focus-visible:ring-ring/50 focus-visible:ring-[3px] sm:py-2.5",
                  "lg:flex-row lg:gap-3 lg:px-3 lg:text-sm",
                  active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/60",
                )}
              >
                <Icon className="size-5 shrink-0" aria-hidden />
                <span className="sm:sr-only lg:not-sr-only">{label}</span>
                {id === "history" && <Badge count={unseenMissed} tone="destructive" />}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
