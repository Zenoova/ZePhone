import { Grid3x3, Mic, MicOff, Pause, Phone, PhoneForwarded, PhoneOff, Play } from "@/components/icons";
import { useState, type ReactNode } from "react";

import { VoiceOrb } from "@/components/VoiceOrb";
import { Button } from "@/components/ui/button";
import { useCallDuration } from "@/hooks/use-call-duration";
import { callDisplayName, formatDuration } from "@/lib/format";
import { CALL_STATE_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { isTerminal, useCallsStore } from "@/stores/calls-store";
import type { Call } from "@/types/telephony";

import { Dialpad } from "../dialer/Dialpad";
import { AudioNoticeBanner } from "./AudioNoticeBanner";
import { TransferDialog } from "./TransferDialog";

function Control({
  label,
  ariaLabel,
  active,
  disabled,
  danger,
  onClick,
  children,
}: {
  label: string;
  ariaLabel: string;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-pressed={active}
        aria-label={ariaLabel}
        className={cn(
          "flex size-14 items-center justify-center rounded-full border transition-[background-color,color,transform,opacity] duration-200 outline-none",
          "focus-visible:ring-ring/50 active:scale-95 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-40",
          danger
            ? "bg-destructive hover:bg-destructive/90 border-transparent text-white"
            : active
              ? "bg-foreground text-background border-transparent"
              : "bg-card/80 hover:bg-accent backdrop-blur",
        )}
      >
        {children}
      </button>
      <span
        aria-hidden
        className={cn(
          "text-[11px] leading-none font-medium",
          disabled ? "text-muted-foreground/60" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * The call screen: the remote party's voice as a living orb in the middle and the aligned controls at the
 * bottom. The keypad rises over the orb as a blurred glass sheet.
 */
export function CallPanel({ call }: { call: Call }) {
  const { answer, reject, hangup, toggleHold, toggleMute, sendDtmf } = useCallsStore.getState();
  const seconds = useCallDuration(call);
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  const name = callDisplayName(call);
  const terminal = isTerminal(call);
  const incoming = call.state === "incoming";
  const inDialog = call.state === "connected" || call.state === "onHold";
  const onHold = call.state === "onHold";
  const subtitle = call.remoteName && call.remoteNumber !== name ? call.remoteNumber : null;
  const showKeypad = keypadOpen && inDialog;

  return (
    <section
      aria-label={`Call with ${name}`}
      data-testid="call-panel"
      data-state={call.state}
      className="relative flex h-full min-h-[30rem] w-full flex-col items-center overflow-hidden px-5 pt-7 pb-6"
    >
      {/* soft light behind the orbs */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-3/4 bg-[radial-gradient(55%_50%_at_50%_38%,color-mix(in_oklab,var(--primary)_16%,transparent),transparent)]"
      />

      <header className="relative z-10 flex flex-col items-center gap-0.5 text-center">
        {call.accountLabel && <p className="text-muted-foreground text-xs">{call.accountLabel}</p>}
        <h2 className="max-w-[20rem] truncate text-2xl font-semibold" data-selectable>
          {name}
        </h2>
        {subtitle && (
          <p className="text-muted-foreground text-sm" data-selectable>
            {subtitle}
          </p>
        )}
        <p
          role="status"
          className={cn(
            "mt-1 text-sm font-medium",
            call.state === "failed" && "text-destructive",
            call.state === "connected" && "text-success",
            onHold && "text-warning-foreground dark:text-warning",
            !inDialog && !terminal && "text-muted-foreground",
          )}
        >
          {CALL_STATE_LABEL[call.state]}
          {onHold && call.heldRemotely && !call.heldLocally && " by the other party"}
        </p>
        {(inDialog || (terminal && call.durationSecs > 0)) && (
          <p className="tabular text-xl font-light tracking-wider" aria-label="Call duration">
            {formatDuration(seconds)}
          </p>
        )}
        {call.state === "failed" && call.reason && (
          <p className="text-muted-foreground max-w-xs text-xs">{call.reason}</p>
        )}
      </header>

      <AudioNoticeBanner />

      {/* the voice of the other party */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-3">
        <div
          data-testid="orb-remote"
          className={cn(
            "relative size-[clamp(12rem,44vh,22rem)]",
            (incoming || call.state === "ringing") && "animate-ring-pulse rounded-full",
          )}
        >
          <VoiceOrb callId={call.id} paused={onHold || terminal} waiting={!inDialog && !terminal} />
          {onHold && (
            <Pause
              className="text-foreground/70 absolute top-1/2 left-1/2 size-1/5 -translate-x-1/2 -translate-y-1/2"
              aria-hidden
            />
          )}
        </div>
      </div>

      {incoming && (
        <div className="relative z-10 flex w-full max-w-sm items-center justify-center gap-4">
          <Button
            variant="destructive"
            size="lg"
            className="h-14 flex-1 rounded-2xl dark:bg-destructive dark:hover:bg-destructive/90"
            onClick={() => void reject(call.id)}
          >
            <PhoneOff className="size-5" aria-hidden /> Decline
          </Button>
          <Button
            size="lg"
            className="bg-success text-success-foreground hover:bg-success/90 h-14 flex-1 rounded-2xl"
            onClick={() => void answer(call.id)}
          >
            <Phone className="size-5" aria-hidden /> Answer
          </Button>
        </div>
      )}

      {!incoming && !terminal && (
        <div className="relative z-10 w-full max-w-sm">
          {/* keypad: a blurred glass sheet that rises over the voices, right above the controls */}
          <div
            inert={!showKeypad}
            aria-hidden={!showKeypad}
            data-testid="keypad-sheet"
            className={cn(
              "glass absolute right-0 bottom-full left-0 mb-3 origin-bottom rounded-3xl p-3.5",
              "transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
              showKeypad
                ? "translate-y-0 scale-100 opacity-100"
                : "pointer-events-none translate-y-6 scale-95 opacity-0",
            )}
          >
            <Dialpad
              compact
              captureKeyboard={showKeypad}
              className="mx-auto max-w-64"
              onKey={(k) => void sendDtmf(call.id, k)}
            />
          </div>
          <div role="group" aria-label="Call controls" className="grid w-full grid-cols-5 gap-2">
            <Control
              label="Mic"
              ariaLabel={call.muted ? "Unmute" : "Mute the microphone"}
              active={call.muted}
              disabled={!inDialog}
              onClick={() => void toggleMute(call.id)}
            >
              {call.muted ? <MicOff className="size-6" /> : <Mic className="size-6" />}
            </Control>
            <Control
              label="Hold"
              ariaLabel={call.heldLocally ? "Resume the call" : "Put on hold"}
              active={call.heldLocally}
              disabled={!inDialog}
              onClick={() => void toggleHold(call.id)}
            >
              {call.heldLocally ? <Play className="size-6" /> : <Pause className="size-6" />}
            </Control>
            <Control
              label="Keypad"
              ariaLabel="Keypad (DTMF tones)"
              active={showKeypad}
              disabled={!inDialog}
              onClick={() => setKeypadOpen((v) => !v)}
            >
              <Grid3x3 className="size-6" />
            </Control>
            <Control
              label="Transfer"
              ariaLabel="Transfer the call"
              disabled={!inDialog}
              onClick={() => setTransferOpen(true)}
            >
              <PhoneForwarded className="size-6" />
            </Control>
            <Control label="Hang up" ariaLabel="Hang up" danger onClick={() => void hangup(call.id)}>
              <PhoneOff className="size-6" />
            </Control>
          </div>
        </div>
      )}
      {!incoming && !terminal && <TransferDialog callId={call.id} open={transferOpen} onOpenChange={setTransferOpen} />}
    </section>
  );
}
