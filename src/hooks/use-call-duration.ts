import { useEffect, useState } from "react";

import { elapsedSince } from "@/lib/format";
import type { Call } from "@/types/telephony";

/**
 * Seconds of conversation for a call: ticks while connected, frozen to the
 * backend's authoritative duration once the call has ended.
 */
export function useCallDuration(call: Pick<Call, "connectedAt" | "endedAt" | "durationSecs"> | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  const running = Boolean(call?.connectedAt) && !call?.endedAt;

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [running]);

  if (!call) return 0;
  if (call.endedAt) return call.durationSecs;
  return elapsedSince(call.connectedAt, now);
}
