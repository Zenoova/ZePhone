import { PhoneCall } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { sortedCalls, useCallsStore } from "@/stores/calls-store";
import { useUiStore } from "@/stores/ui-store";

import { CallPanel } from "./CallPanel";

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
  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-5">
      {calls.map((c) => (
        <CallPanel key={c.id} call={c} />
      ))}
    </div>
  );
}
