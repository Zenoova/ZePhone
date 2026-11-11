import type { Call } from "@/types/telephony";

const terminal = (c: Call): boolean => c.state === "ended" || c.state === "failed";

/**
 * After the last call ends (hang-up, remote hang-up, failure, missed...), a user who is looking at
 * the call screen goes back to the dialer. Someone browsing contacts/settings is left alone.
 */
export function shouldReturnToDialer(prev: Record<string, Call>, next: Record<string, Call>, section: string): boolean {
  if (section !== "calls") return false;
  const calls = Object.values(next);
  const justEnded = calls.some((c) => terminal(c) && !(prev[c.id] && terminal(prev[c.id] as Call)));
  return justEnded && !calls.some((c) => !terminal(c));
}
