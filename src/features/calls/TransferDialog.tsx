import { toast } from "@yusufceng1z/ding-react";
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
    if (!target.trim()) {
      toast.error("Enter the number or extension to transfer the call to.");
      return;
    }
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
        title="Transfer the call"
        description="Choose a contact from the directory, or enter the extension or number to transfer this call to."
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
          <Label htmlFor="transfer-target">Recipient</Label>
          <Input
            id="transfer-target"
            autoFocus
            value={target}
            onChange={(e) => {
              setTarget(sanitizeDialInput(e.target.value));
              setPicked(null);
            }}
            placeholder="Extension, number or SIP address"
            autoComplete="off"
          />
          {picked && (
            <p className="text-muted-foreground text-xs" data-testid="transfer-picked">
              {picked}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-3">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              <PhoneForwarded className="size-4" aria-hidden /> Transfer
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
