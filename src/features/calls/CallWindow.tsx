import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";

import { telephony } from "@/services/telephony";
import { isTerminal, sortedCalls, useCallsStore } from "@/stores/calls-store";

import { CallPanel } from "./CallPanel";
import { CallRow } from "./CallRow";
import { CallToolbar } from "./CallToolbar";

/** How long the window waits for a first call before giving up (the call may already be over). */
const NO_CALL_GRACE_MS = 4000;

/**
 * The content of the call window: the call in progress on the full call screen (a call that just ended stays
 * for a few seconds, as "Ended" or with its failure), any other call as a compact line, and the toolbar at
 * the top right. The window closes itself once there is nothing left to show.
 */
export function CallWindow() {
  const calls = useCallsStore(useShallow((s) => sortedCalls(s.calls)));
  const seen = useRef(false);

  useEffect(() => {
    if (calls.length > 0) {
      seen.current = true;
      return;
    }
    // Nothing to show: close once the last call has gone, or if no call ever shows up.
    const t = setTimeout(() => void telephony.closeCallWindow(), seen.current ? 0 : NO_CALL_GRACE_MS);
    return () => clearTimeout(t);
  }, [calls.length]);

  const live = calls.filter((c) => !isTerminal(c));
  // The call in progress gets the full screen; any other call (call waiting...) is a compact line.
  const primary = live.find((c) => c.state !== "incoming") ?? live[0] ?? calls[calls.length - 1];
  if (!primary) return <div className="h-full" data-testid="call-window-empty" />;
  const others = live.filter((c) => c.id !== primary.id);

  return (
    <div className="relative flex h-full flex-col" data-testid="call-window">
      <CallToolbar call={primary} />
      {others.length > 0 && (
        <div className="space-y-2 px-4 pt-14">
          {others.map((c) => (
            <CallRow key={c.id} call={c} />
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <CallPanel key={primary.id} call={primary} />
      </div>
    </div>
  );
}
