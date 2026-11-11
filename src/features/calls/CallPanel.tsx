import { Grip, Mic, MicOff, Pause, Phone, PhoneForwarded, PhoneOff, Play } from "lucide-react";
import { useState } from "react";

import { ContactAvatar } from "@/components/ContactAvatar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCallDuration } from "@/hooks/use-call-duration";
import { callDisplayName, formatDuration } from "@/lib/format";
import { CALL_STATE_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { isTerminal, useCallsStore } from "@/stores/calls-store";
import type { Call } from "@/types/telephony";

import { Dialpad } from "../dialer/Dialpad";
import { TransferDialog } from "./TransferDialog";

function ControlButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-pressed={active}
          aria-label={label}
          className={cn(
            "flex size-14 flex-col items-center justify-center rounded-full border transition-colors outline-none",
            "focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-40",
            active ? "bg-foreground text-background border-transparent" : "bg-card hover:bg-accent",
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Full call screen: state, name/number, timer, and the in-call controls. */
export function CallPanel({ call }: { call: Call }) {
  const { answer, reject, hangup, toggleHold, toggleMute, sendDtmf } = useCallsStore.getState();
  const seconds = useCallDuration(call);
  const [showKeypad, setShowKeypad] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  const name = callDisplayName(call);
  const terminal = isTerminal(call);
  const incoming = call.state === "incoming";
  const inDialog = call.state === "connected" || call.state === "onHold";
  const subtitle = call.remoteName && call.remoteNumber !== name ? call.remoteNumber : null;

  return (
    <section
      aria-label={`Appel avec ${name}`}
      data-testid="call-panel"
      data-state={call.state}
      className="bg-card mx-auto flex w-full max-w-md flex-col items-center gap-5 rounded-3xl border p-6 shadow-sm"
    >
      {call.accountLabel && <p className="text-muted-foreground text-xs">{call.accountLabel}</p>}

      <div className="flex flex-col items-center gap-3 text-center">
        <ContactAvatar
          name={name}
          className={cn("size-24 text-3xl", (incoming || call.state === "ringing") && "animate-ring-pulse")}
        />
        <div className="min-w-0">
          <h2 className="max-w-[18rem] truncate text-2xl font-semibold" data-selectable>
            {name}
          </h2>
          {subtitle && (
            <p className="text-muted-foreground text-sm" data-selectable>
              {subtitle}
            </p>
          )}
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <p
            className={cn(
              "text-sm font-medium",
              call.state === "failed" && "text-destructive",
              call.state === "connected" && "text-success",
              call.state === "onHold" && "text-warning-foreground dark:text-warning",
            )}
            role="status"
          >
            {CALL_STATE_LABEL[call.state]}
            {call.state === "onHold" && call.heldRemotely && !call.heldLocally && " par le correspondant"}
          </p>
          {(inDialog || (terminal && call.durationSecs > 0)) && (
            <p className="tabular text-2xl font-light tracking-wider" aria-label="Durée de l'appel">
              {formatDuration(seconds)}
            </p>
          )}
          {call.state === "failed" && call.reason && <p className="text-muted-foreground max-w-xs text-xs">{call.reason}</p>}
        </div>
      </div>

      {incoming && (
        <div className="flex w-full items-center justify-center gap-6">
          <Button
            variant="destructive"
            size="lg"
            className="h-14 flex-1 rounded-2xl dark:bg-destructive dark:hover:bg-destructive/90"
            onClick={() => void reject(call.id)}
          >
            <PhoneOff className="size-5" aria-hidden /> Refuser
          </Button>
          <Button
            size="lg"
            className="bg-success text-success-foreground hover:bg-success/90 h-14 flex-1 rounded-2xl"
            onClick={() => void answer(call.id)}
          >
            <Phone className="size-5" aria-hidden /> Répondre
          </Button>
        </div>
      )}

      {!incoming && !terminal && (
        <>
          <div className="flex items-center justify-center gap-3">
            <ControlButton
              label={call.muted ? "Réactiver le micro" : "Couper le micro"}
              active={call.muted}
              disabled={!inDialog}
              onClick={() => void toggleMute(call.id)}
            >
              {call.muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
            </ControlButton>
            <ControlButton
              label={call.heldLocally ? "Reprendre l'appel" : "Mettre en attente"}
              active={call.heldLocally}
              disabled={!inDialog}
              onClick={() => void toggleHold(call.id)}
            >
              {call.heldLocally ? <Play className="size-5" /> : <Pause className="size-5" />}
            </ControlButton>
            <ControlButton label="Clavier (tonalités DTMF)" active={showKeypad} disabled={!inDialog} onClick={() => setShowKeypad((v) => !v)}>
              <Grip className="size-5" />
            </ControlButton>
            <ControlButton label="Transférer l'appel" disabled={!inDialog} onClick={() => setTransferOpen(true)}>
              <PhoneForwarded className="size-5" />
            </ControlButton>
          </div>

          {showKeypad && inDialog && (
            <Dialpad compact className="w-full max-w-64" onKey={(k) => void sendDtmf(call.id, k)} />
          )}

          <Button
            variant="destructive"
            size="lg"
            className="h-14 w-full max-w-64 rounded-2xl text-base font-semibold dark:bg-destructive dark:hover:bg-destructive/90"
            onClick={() => void hangup(call.id)}
          >
            <PhoneOff className="size-5" aria-hidden /> Raccrocher
          </Button>
          <TransferDialog callId={call.id} open={transferOpen} onOpenChange={setTransferOpen} />
        </>
      )}
    </section>
  );
}
