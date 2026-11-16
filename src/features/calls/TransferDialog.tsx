import { PhoneForwarded } from "@/components/icons";
import { useState } from "react";

import { Button } from "@/components/arc/button/button";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sanitizeDialInput } from "@/lib/phone";
import { telephony } from "@/services/telephony";
import { useCallsStore } from "@/stores/calls-store";

import { DirectoryPicker } from "./DirectoryPicker";

export function TransferDialog({
  callId,
  open,
  onOpenChange,
}: {
  callId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [target, setTarget] = useState("");
  /** Who the number in the field was picked for, when it came from the directory. */
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const transfer = useCallsStore((s) => s.transfer);

  const submit = async () => {
    if (!target.trim()) return;
    setBusy(true);
    // A number picked from the directory is shown as written; what is transferred to is its dialling form.
    const wanted = target.trim();
    const dialable = await telephony.directoryDialable(wanted).catch(() => null);
    const ok = await transfer(callId, dialable ?? wanted);
    setBusy(false);
    if (ok) {
      setTarget("");
      setPicked(null);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Transférer l'appel"
        description="Choisissez un contact de l'annuaire, ou saisissez le poste ou le numéro vers lequel transférer cet appel."
      >
        <div className="mb-4">
          <DirectoryPicker
            onPick={(number, who, kind) => {
              setTarget(number);
              setPicked(`${who} · ${kind}`);
            }}
          />
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-2"
        >
          <Label htmlFor="transfer-target">Destinataire</Label>
          <Input
            id="transfer-target"
            autoFocus
            value={target}
            onChange={(e) => {
              setTarget(sanitizeDialInput(e.target.value));
              setPicked(null);
            }}
            placeholder="Poste, numéro ou adresse SIP"
            autoComplete="off"
          />
          {picked && (
            <p className="text-muted-foreground text-xs" data-testid="transfer-picked">
              {picked}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-3">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={busy || !target.trim()}>
              <PhoneForwarded className="size-4" aria-hidden /> Transférer
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
