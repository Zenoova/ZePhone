import { useShallow } from "zustand/react/shallow";

import { isTerminal, sortedCalls, useCallsStore } from "@/stores/calls-store";

import { CallPanel } from "./CallPanel";
import { CallRow } from "./CallRow";

/** Every call in progress: the main one on the full call screen, the others as compact lines. */
export function CallsView() {
  const calls = useCallsStore(useShallow((s) => sortedCalls(s.calls).filter((c) => !isTerminal(c))));
  if (calls.length === 0) return null;

  // The call in progress gets the full screen; any other call (call waiting...) is a compact line below.
  const primary = calls.find((c) => c.state !== "incoming") ?? calls[0]!;
  const others = calls.filter((c) => c.id !== primary.id);

  return (
    <div className="flex h-full flex-col">
      {others.length > 0 && (
        <div className="space-y-2 px-4 pt-4">
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
