import { toast } from "@yusufceng1z/ding-react";

import { telephony } from "@/services/telephony";
import { useCallsStore } from "@/stores/calls-store";
import { useUiStore } from "@/stores/ui-store";
import type { Call } from "@/types/telephony";

/** What to dial for a number as the directory shows it; the number itself when the backend cannot say. */
async function dialable(number: string): Promise<string> {
  try {
    return (await telephony.directoryDialable(number)) ?? number;
  } catch {
    return number;
  }
}

export interface DirectoryActions {
  /** The call a transfer would move: the one in progress (not one on hold). */
  activeCall: Call | undefined;
  /** Calls a number through the application's own dialling, and goes to the call screen. */
  call: (number: string) => Promise<boolean>;
  /** Transfers the call in progress to a number, through the application's own transfer. */
  transfer: (number: string) => Promise<boolean>;
  copy: (number: string) => Promise<void>;
}

export function useDirectoryActions(): DirectoryActions {
  const dial = useCallsStore((s) => s.dial);
  const transfer = useCallsStore((s) => s.transfer);
  const activeCall = useCallsStore((s) => Object.values(s.calls).find((c) => c.state === "connected"));
  const setSection = useUiStore((s) => s.setSection);

  return {
    activeCall,
    call: async (number) => {
      const started = await dial(await dialable(number));
      if (started) setSection("dialer");
      return started !== null;
    },
    transfer: async (number) => {
      if (!activeCall) return false;
      const ok = await transfer(activeCall.id, await dialable(number));
      if (ok) toast.success("Transfer requested");
      return ok;
    },
    copy: async (number) => {
      try {
        await navigator.clipboard.writeText(number);
        toast.success("Number copied");
      } catch {
        toast.error("Cannot copy the number");
      }
    },
  };
}
