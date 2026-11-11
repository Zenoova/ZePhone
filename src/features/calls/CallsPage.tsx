import { PhoneCall } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { isTerminal, sortedCalls, useCallsStore } from "@/stores/calls-store";
import { useUiStore } from "@/stores/ui-store";

import { CallPanel } from "./CallPanel";
import { CallRow } from "./CallRow";

export function CallsPage() {
  const calls = useCallsStore(useShallow((s) => sortedCalls(s.calls)));
  const setSection = useUiStore((s) => s.setSection);

  if (calls.length === 0) {
    return (
      <EmptyState
        icon={PhoneCall}
        title="Aucun appel en cours"
        description="Les appels en cours et entrants apparaissent ici, avec micro, attente, clavier et transfert."
        action={<Button onClick={() => setSection("dialer")}>Ouvrir le clavier</Button>}
      />
    );
  }

  // The call in progress gets the full screen; any other call (call waiting...) is a compact line below.
  const primary = calls.find((c) => c.state !== "incoming" && !isTerminal(c)) ?? calls[0]!;
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
