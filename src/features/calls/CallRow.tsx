import { Pause, Phone, PhoneOff, Play } from "@/components/icons";

import { ContactAvatar } from "@/components/ContactAvatar";
import { Button } from "@/components/ui/button";
import { useCallDuration } from "@/hooks/use-call-duration";
import { callDisplayName, formatDuration } from "@/lib/format";
import { CALL_STATE_LABEL } from "@/lib/labels";
import { isTerminal, useCallsStore } from "@/stores/calls-store";
import type { Call } from "@/types/telephony";

/** Compact line for a secondary call (call waiting, second line) next to the main call screen. */
export function CallRow({ call }: { call: Call }) {
  const { answer, reject, hangup, toggleHold } = useCallsStore.getState();
  const seconds = useCallDuration(call);
  const name = callDisplayName(call);
  const incoming = call.state === "incoming";
  const inDialog = call.state === "connected" || call.state === "onHold";

  return (
    <div
      data-testid="call-row"
      data-state={call.state}
      className="bg-card flex items-center gap-3 rounded-2xl border p-3"
    >
      <ContactAvatar name={name} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" data-selectable>
          {name}
        </p>
        <p className="text-muted-foreground text-xs">
          {CALL_STATE_LABEL[call.state]}
          {inDialog && <span className="tabular"> · {formatDuration(seconds)}</span>}
        </p>
      </div>
      {incoming && (
        <>
          <Button
            size="icon"
            variant="destructive"
            className="rounded-full"
            aria-label={`Refuser ${name}`}
            onClick={() => void reject(call.id)}
          >
            <PhoneOff className="size-4" />
          </Button>
          <Button
            size="icon"
            className="bg-success text-success-foreground hover:bg-success/90 rounded-full"
            aria-label={`Répondre à ${name}`}
            onClick={() => void answer(call.id)}
          >
            <Phone className="size-4" />
          </Button>
        </>
      )}
      {inDialog && (
        <Button
          size="icon"
          variant="outline"
          className="rounded-full"
          aria-label={call.heldLocally ? `Reprendre ${name}` : `Mettre ${name} en attente`}
          onClick={() => void toggleHold(call.id)}
        >
          {call.heldLocally ? <Play className="size-4" /> : <Pause className="size-4" />}
        </Button>
      )}
      {!incoming && !isTerminal(call) && (
        <Button
          size="icon"
          variant="destructive"
          className="rounded-full"
          aria-label={`Raccrocher ${name}`}
          onClick={() => void hangup(call.id)}
        >
          <PhoneOff className="size-4" />
        </Button>
      )}
    </div>
  );
}
