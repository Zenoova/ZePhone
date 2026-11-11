import { Phone, PhoneIncoming, PhoneOff } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import { ContactAvatar } from "@/components/ContactAvatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { callDisplayName } from "@/lib/format";
import { selectIncoming, useCallsStore } from "@/stores/calls-store";
import { useUiStore } from "@/stores/ui-store";

/** Modal shown on top of any section (dialer, contacts, settings...) when a call comes in. */
export function IncomingCallDialog() {
  const incoming = useCallsStore(useShallow((s) => selectIncoming(s.calls)));
  const { answer, reject } = useCallsStore.getState();
  const setSection = useUiStore((s) => s.setSection);
  const call = incoming[0];

  return (
    <Dialog open={Boolean(call)}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-sm"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {call && (
          <div className="flex flex-col items-center gap-4 py-2 text-center" data-testid="incoming-call">
            <div className="text-success flex items-center gap-2 text-sm font-medium">
              <PhoneIncoming className="size-4" aria-hidden /> Appel entrant
              {incoming.length > 1 && <span className="text-muted-foreground">(+{incoming.length - 1})</span>}
            </div>
            <ContactAvatar name={callDisplayName(call)} className="animate-ring-pulse size-24 text-3xl" />
            <div className="min-w-0">
              <DialogTitle className="max-w-[16rem] truncate text-2xl" data-selectable>
                {callDisplayName(call)}
              </DialogTitle>
              <DialogDescription className="mt-1" data-selectable>
                {call.remoteName ? `${call.remoteNumber} · ` : ""}
                {call.accountLabel ?? "Compte SIP"}
              </DialogDescription>
            </div>
            <div className="flex w-full gap-3 pt-2">
              <Button variant="destructive" size="lg" className="h-14 flex-1 rounded-2xl dark:bg-destructive dark:hover:bg-destructive/90" onClick={() => void reject(call.id)}>
                <PhoneOff className="size-5" aria-hidden /> Refuser
              </Button>
              <Button
                size="lg"
                className="bg-success text-success-foreground hover:bg-success/90 h-14 flex-1 rounded-2xl"
                autoFocus
                onClick={() => {
                  void answer(call.id);
                  setSection("calls");
                }}
              >
                <Phone className="size-5" aria-hidden /> Répondre
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
