import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { CALL_STATE_LABEL } from "@/lib/labels";
import type { Call } from "@/types/telephony";

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("en-US") : "—";
}

/** What the backend knows about a call: for support, and for developers wiring a PBX. */
export function CallInfoDialog({
  call,
  open,
  onOpenChange,
}: {
  call: Call;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const rows: Array<[string, string]> = [
    ["Call ID", call.id],
    ["State", CALL_STATE_LABEL[call.state]],
    ["Direction", call.direction === "incoming" ? "Incoming" : "Outgoing"],
    ["Remote URI", call.remoteUri],
    ["Number", call.remoteNumber],
    ["Name", call.remoteName ?? "—"],
    ["Account", call.accountLabel ?? "—"],
    ["Created", when(call.createdAt)],
    ["Connected", when(call.connectedAt)],
    ["Ended", when(call.endedAt)],
    ["Duration", `${call.durationSecs} s`],
    ["SIP code", call.sipCode ? String(call.sipCode) : "—"],
    ["Reason", call.reason ?? "—"],
    ["Muted", call.muted ? "yes" : "no"],
    ["On hold", call.heldLocally ? "by us" : call.heldRemotely ? "by the other party" : "no"],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Call information" description="The state of the call as the SIP engine reports it.">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm" data-testid="call-info">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-mono text-xs break-all" data-selectable>
                {v}
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
