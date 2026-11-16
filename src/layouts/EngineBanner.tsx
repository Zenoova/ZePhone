import { TriangleAlert, LoaderCircle } from "@/components/icons";

import { Button } from "@/components/arc/button/button";
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
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
        The SIP engine is restarting (attempt {info.attempt})… {info.reason}
      </div>
    );
  }
  if (info.state === "failed" || info.state === "stopped") {
    return (
      <div
        role="alert"
        className="bg-destructive/10 text-destructive flex flex-wrap items-center gap-3 px-4 py-2 text-sm"
      >
        <TriangleAlert className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          {info.state === "failed" ? `SIP engine unavailable: ${info.reason}` : "The SIP engine is stopped."}
        </span>
        <Button size="sm" variant="secondary" disabled={restarting} onClick={() => void restart()}>
          Restart
        </Button>
      </div>
    );
  }
  return null;
}
