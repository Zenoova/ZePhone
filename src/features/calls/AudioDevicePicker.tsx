import { Check, Mic, MicOff } from "@/components/icons";
import { useState } from "react";

import { Badge } from "@/components/arc/badge/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/arc/popover/popover";
import { Switch } from "@/components/arc/switch/switch";
import { Button } from "@/components/arc/button/button";
import { ROLE_LABEL, TRANSPORT_LABEL, bluetoothNote } from "@/lib/audio";
import { cn } from "@/lib/utils";
import { useAudioStore } from "@/stores/audio-store";
import type { DeviceInfo, Role } from "@/types/audio";
import type { Call } from "@/types/telephony";

/** The devices a role could use, the one in use ticked; picking one moves the call to it. */
export function DeviceChoices({ role, remember, compact }: { role: Role; remember: boolean; compact?: boolean }) {
  const rs = useAudioStore((s) => s.state?.roles.find((r) => r.role === role));
  const choose = useAudioStore((s) => s.choose);
  if (!rs) return null;
  const inUse = rs.inUse;
  const defaults = useAudioStore.getState().state?.snapshot;
  const isDefault = (d: DeviceInfo) =>
    d.uid === (role === "microphone" ? defaults?.defaultInput : defaults?.defaultOutput);
  return (
    <ul aria-label={ROLE_LABEL[role]} className="space-y-0.5">
      {rs.choices.map((d) => {
        const active = inUse?.uid === d.uid;
        return (
          <li key={d.uid}>
            <button
              type="button"
              disabled={!d.selectable}
              onClick={() => void choose(role, d.uid, remember)}
              aria-current={active ? "true" : undefined}
              className={cn(
                "hover:bg-accent flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50",
                active && "bg-accent/60 font-medium",
              )}
            >
              <span className="flex size-4 shrink-0 items-center justify-center">
                {active && <Check className="size-4" aria-hidden />}
              </span>
              <span className="min-w-0 flex-1 truncate">{d.name}</span>
              {!compact && <span className="text-muted-foreground text-xs">{TRANSPORT_LABEL[d.transport]}</span>}
              {isDefault(d) && <span className="text-muted-foreground text-xs">default</span>}
              {d.publicSpeaker && <Badge tone="warning">speaker</Badge>}
            </button>
          </li>
        );
      })}
      {rs.choices.length === 0 && <li className="text-muted-foreground px-2 py-1 text-sm">No device.</li>}
    </ul>
  );
}

/**
 * Quick access to the devices during a call: readable names, the one in use, and a microphone indicator (muted or
 * live). A choice made here is for this call; "keep" makes it the saved choice.
 */
export function AudioDevicePicker({ call }: { call: Call }) {
  const state = useAudioStore((s) => s.state);
  const [remember, setRemember] = useState(false);
  const mic = state?.roles.find((r) => r.role === "microphone");
  const hasNotice = state?.roles.some((r) => r.notice?.kind === "lost" || r.notice?.kind === "failed");
  const bt = bluetoothNote(mic?.inUse);
  const MicIcon = call.muted ? MicOff : Mic;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Audio devices"
          title={`Audio devices — microphone ${call.muted ? "muted" : "active"}`}
          className="relative"
        >
          <MicIcon className={cn("size-4", call.muted && "text-destructive")} />
          {hasNotice && <span aria-hidden className="bg-warning absolute top-1 right-1 size-2 rounded-full" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <p
          role="status"
          data-testid="mic-indicator"
          className={cn(
            "flex items-center gap-2 text-sm font-medium",
            call.muted ? "text-destructive" : "text-success",
          )}
        >
          <MicIcon className="size-4" aria-hidden />
          {call.muted ? "Muted" : "Microphone on"}
        </p>
        <div className="space-y-1">
          <h3 className="text-muted-foreground px-2 text-xs font-medium uppercase">Microphone</h3>
          <DeviceChoices role="microphone" remember={remember} compact />
        </div>
        <div className="space-y-1">
          <h3 className="text-muted-foreground px-2 text-xs font-medium uppercase">Sortie</h3>
          <DeviceChoices role="speaker" remember={remember} compact />
        </div>
        <label className="flex items-center justify-between gap-3 border-t pt-3 text-xs">
          <span>Keep this choice for future calls</span>
          <Switch checked={remember} onCheckedChange={setRemember} aria-label="Keep this choice" />
        </label>
        {bt && <p className="text-muted-foreground text-xs">{bt}</p>}
      </PopoverContent>
    </Popover>
  );
}
