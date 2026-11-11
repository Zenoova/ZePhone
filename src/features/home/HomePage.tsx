import { CallsView } from "@/features/calls/CallsView";
import { DialerPage } from "@/features/dialer/DialerPage";
import { isTerminal, useCallsStore } from "@/stores/calls-store";

/**
 * The home page: the keypad when idle, the call screen as soon as a call is in progress (and the
 * keypad again when it is over).
 */
export function HomePage() {
  const inCall = useCallsStore((s) => Object.values(s.calls).some((c) => !isTerminal(c)));
  return (
    <div key={inCall ? "call" : "keypad"} className="animate-in fade-in-0 h-full duration-300">
      {inCall ? <CallsView /> : <DialerPage />}
    </div>
  );
}
