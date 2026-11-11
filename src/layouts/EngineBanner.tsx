import { AlertTriangle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useEngineStore } from "@/stores/engine-store";

/** Visible only when the SIP engine is not healthy. */
export function EngineBanner() {
  const info = useEngineStore((s) => s.info);
  const restarting = useEngineStore((s) => s.restarting);
  const restart = useEngineStore((s) => s.restart);
  if (!info) return null;

  if (info.state === "restarting") {
    return (
      <div role="status" className="bg-warning/20 flex items-center gap-2 px-4 py-2 text-sm">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Le moteur SIP redémarre (tentative {info.attempt})… {info.reason}
      </div>
    );
  }
  if (info.state === "failed" || info.state === "stopped") {
    return (
      <div role="alert" className="bg-destructive/10 text-destructive flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          {info.state === "failed" ? `Moteur SIP indisponible : ${info.reason}` : "Le moteur SIP est arrêté."}
        </span>
        <Button size="sm" variant="outline" disabled={restarting} onClick={() => void restart()}>
          Redémarrer
        </Button>
      </div>
    );
  }
  return null;
}
