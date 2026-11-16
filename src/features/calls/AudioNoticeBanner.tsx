import { TriangleAlert } from "@/components/icons";
import { useState } from "react";

import { Button } from "@/components/arc/button/button";
import { noticeDetail, noticeTitle } from "@/lib/audio";
import { useAudioStore } from "@/stores/audio-store";

import { DeviceChoices } from "./AudioDevicePicker";

/**
 * What happened to the call's audio devices, right where the call is: a device went away, the call was moved,
 * or the engine could not use one. The call itself is never dropped by any of this.
 */
export function AudioNoticeBanner() {
  const roles = useAudioStore((s) => s.state?.roles);
  const [choosing, setChoosing] = useState(false);
  const noticed = roles?.filter((r) => r.notice && r.role !== "ringer") ?? [];
  if (noticed.length === 0) return null;
  return (
    <div className="relative z-20 w-full space-y-2" data-testid="audio-notices">
      {noticed.map((r) => {
        const n = r.notice!;
        const needsChoice = n.kind !== "switched";
        return (
          <div
            key={r.role}
            role={needsChoice ? "alert" : "status"}
            className="border-warning/40 bg-warning/15 mx-auto flex max-w-md flex-col gap-2 rounded-xl border px-3 py-2 text-sm"
          >
            <div className="flex items-start gap-2">
              <TriangleAlert className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
              <div>
                <p className="font-medium">{noticeTitle(n)}</p>
                <p className="text-muted-foreground text-xs">{noticeDetail(n)}</p>
              </div>
            </div>
            {needsChoice && (
              <>
                <Button size="sm" variant="secondary" onClick={() => setChoosing((c) => !c)} aria-expanded={choosing}>
                  Choisir un autre périphérique
                </Button>
                {choosing && <DeviceChoices role={r.role} remember={false} />}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
