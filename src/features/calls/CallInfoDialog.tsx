import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { CALL_STATE_LABEL } from "@/lib/labels";
import type { Call } from "@/types/telephony";

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("fr-FR") : "—";
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
    ["Identifiant", call.id],
    ["État", CALL_STATE_LABEL[call.state]],
    ["Sens", call.direction === "incoming" ? "Entrant" : "Sortant"],
    ["URI distante", call.remoteUri],
    ["Numéro", call.remoteNumber],
    ["Nom", call.remoteName ?? "—"],
    ["Compte", call.accountLabel ?? "—"],
    ["Créé", when(call.createdAt)],
    ["Connecté", when(call.connectedAt)],
    ["Terminé", when(call.endedAt)],
    ["Durée", `${call.durationSecs} s`],
    ["Code SIP", call.sipCode ? String(call.sipCode) : "—"],
    ["Motif", call.reason ?? "—"],
    ["Micro coupé", call.muted ? "oui" : "non"],
    ["En attente", call.heldLocally ? "par nous" : call.heldRemotely ? "par le correspondant" : "non"],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Informations de l'appel" description="État de l'appel tel que le moteur SIP le rapporte.">
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
