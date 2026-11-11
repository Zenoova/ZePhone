import { PhoneForwarded } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sanitizeDialInput } from "@/lib/phone";
import { useCallsStore } from "@/stores/calls-store";

export function TransferDialog({ callId, open, onOpenChange }: { callId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const transfer = useCallsStore((s) => s.transfer);

  const submit = async () => {
    if (!target.trim()) return;
    setBusy(true);
    const ok = await transfer(callId, target.trim());
    setBusy(false);
    if (ok) {
      setTarget("");
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Transférer l'appel</DialogTitle>
          <DialogDescription>Saisissez le poste ou le numéro vers lequel transférer cet appel.</DialogDescription>
        </DialogHeader>
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
            onChange={(e) => setTarget(sanitizeDialInput(e.target.value))}
            placeholder="Poste, numéro ou adresse SIP"
            autoComplete="off"
          />
          <DialogFooter className="pt-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={busy || !target.trim()}>
              <PhoneForwarded className="size-4" aria-hidden /> Transférer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
