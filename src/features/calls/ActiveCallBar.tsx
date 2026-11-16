import { Mic, MicOff, PhoneCall, PhoneOff } from "@/components/icons";
import { useShallow } from "zustand/react/shallow";

import { Button } from "@/components/ui/button";
import { useCallDuration } from "@/hooks/use-call-duration";
import { callDisplayName, formatDuration } from "@/lib/format";
import { CALL_STATE_LABEL } from "@/lib/labels";
import { selectLiveCalls, useCallsStore } from "@/stores/calls-store";
import { telephony } from "@/services/telephony";

/** Slim bar shown above every page while a call is in progress; clicking it brings up the call window. */
export function ActiveCallBar() {
  const live = useCallsStore(useShallow((s) => selectLiveCalls(s.calls)));
  const call = live[0];
  const seconds = useCallDuration(call);
  if (!call) return null;
  const { toggleMute, hangup } = useCallsStore.getState();
  const connected = call.state === "connected" || call.state === "onHold";

  return (
    <div
      role="status"
      data-testid="active-call-bar"
      className="bg-success text-success-foreground flex items-center gap-3 px-4 py-2 text-sm"
    >
      <PhoneCall className="size-4 shrink-0" aria-hidden />
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left font-medium"
        onClick={() => void telephony.openCallWindow()}
      >
        {callDisplayName(call)} ·{" "}
        {connected ? <span className="tabular">{formatDuration(seconds)}</span> : CALL_STATE_LABEL[call.state]}
        {call.state === "onHold" && " (on hold)"}
      </button>
      {connected && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={call.muted ? "Unmute" : "Mute the microphone"}
          className="hover:bg-white/20 hover:text-white"
          onClick={() => void toggleMute(call.id)}
        >
          {call.muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Hang up"
        className="hover:bg-white/20 hover:text-white"
        onClick={() => void hangup(call.id)}
      >
        <PhoneOff className="size-4" />
      </Button>
    </div>
  );
}
