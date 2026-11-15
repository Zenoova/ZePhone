import { useEffect, useState } from "react";

import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { errorMessage, telephony } from "@/services/telephony";

/** The recent output of the SIP engine (secrets are redacted by the backend). */
export function EngineLogDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [lines, setLines] = useState<string[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    telephony
      .getEngineLog(300)
      .then((l) => !cancelled && setLines(l))
      .catch((e) => !cancelled && setLines([errorMessage(e)]));
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Journal du moteur SIP" description="Les 300 dernières lignes, sans mots de passe.">
        <pre
          className="bg-muted max-h-80 overflow-auto rounded-lg p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap"
          data-selectable
          data-testid="engine-log"
        >
          {lines === null ? "Chargement…" : lines.length ? lines.join("\n") : "Journal vide."}
        </pre>
      </DialogContent>
    </Dialog>
  );
}
