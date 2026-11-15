import { OrbPicker } from "@/components/OrbPicker";
import { Dock, DockBadge, DockIcon, DockItem, DockLabel, DockSeparator } from "@/components/ui/dock";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { VoiceOrb } from "@/components/VoiceOrb";
import { isTerminal, useCallsStore } from "@/stores/calls-store";
import { countUnseenMissed, useHistoryStore } from "@/stores/history-store";
import { useUiStore } from "@/stores/ui-store";

import { NAV_ITEMS } from "./nav";

/**
 * The voice of the person we are talking to — and, between calls, the same living orb at rest. It keeps its
 * size when the pointer comes close (a WebGL canvas that is resized on every frame would stutter); clicking it
 * opens the choice of the voice orb used all over the call screen.
 */
function OrbItem() {
  const call = useCallsStore((s) => Object.values(s.calls).find((c) => !isTerminal(c)));
  const callId = call?.id ?? "";
  const waiting = call !== undefined && call.state !== "connected" && call.state !== "onHold";
  return (
    <PopoverTrigger asChild>
      <DockItem
        fixed
        aria-label="Choisir l'orbe vocal"
        data-testid="dock-orb"
        data-in-call={callId !== ""}
        className="bg-transparent p-0 hover:bg-transparent"
      >
        <VoiceOrb callId={callId} waiting={waiting} />
        <DockLabel className="in-data-[state=open]:hidden">Orbe vocal</DockLabel>
      </DockItem>
    </PopoverTrigger>
  );
}

/** The main navigation: a dock at the bottom of the window (⌘1…⌘4 reach the same pages). */
export function NavDock() {
  const section = useUiStore((s) => s.section);
  const setSection = useUiStore((s) => s.setSection);
  const unseenMissed = useHistoryStore((s) => countUnseenMissed(s.entries, s.seenAt));

  return (
    <Popover>
      <nav
        aria-label="Navigation principale"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-2 pt-1 pb-2"
      >
        {/* the orb opens its picker, centred on the whole dock */}
        <PopoverAnchor asChild>
          <Dock className="pointer-events-auto">
            <OrbItem />
            <DockSeparator />
            {NAV_ITEMS.map(({ id, label, icon: Icon, shortcut }) => {
              const missed = id === "history" ? unseenMissed : 0;
              return (
                <DockItem
                  key={id}
                  active={section === id}
                  aria-label={missed > 0 ? `${label} (${missed} en attente)` : label}
                  onClick={() => setSection(id)}
                >
                  <DockIcon>
                    <Icon className="size-1/2" />
                  </DockIcon>
                  {missed > 0 && <DockBadge aria-hidden>{missed > 99 ? "99+" : missed}</DockBadge>}
                  <DockLabel>
                    {label} <span className="opacity-60">⌘{shortcut}</span>
                  </DockLabel>
                </DockItem>
              );
            })}
          </Dock>
        </PopoverAnchor>
      </nav>
      <PopoverContent side="top" align="center" sideOffset={16} collisionPadding={8} className="glass glass-dense w-96">
        <OrbPicker />
      </PopoverContent>
    </Popover>
  );
}
